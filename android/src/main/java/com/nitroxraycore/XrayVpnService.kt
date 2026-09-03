package com.nitroxraycore

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.app.ServiceCompat
import java.util.concurrent.atomic.AtomicReference

class XrayVpnService : VpnService() {
    /**
     * The established TUN. Held in an AtomicReference so that claiming it for
     * teardown is a single atomic swap: whoever wins `getAndSet(null)` owns the
     * close, and nobody can double-close or close a descriptor another thread
     * just installed. `onDestroy` runs on the main thread and must not take
     * [engineLock] (a START worker can hold it across a slow `establish()` +
     * engine start, which would ANR), so lock-free ownership is what makes the
     * destroy path safe.
     */
    private val tunnel = AtomicReference<ParcelFileDescriptor?>(null)

    /**
     * DNS servers the current TUN was built with. A server switch may reuse the
     * established interface only when these are unchanged — otherwise the new
     * connection needs an interface with different resolver settings.
     */
    @Volatile
    private var activeDnsServers: List<String>? = null

    // Serializes all engine/tun mutations (start, switch, stop). START and
    // STOP each run on a worker thread under this lock, so a STOP queued
    // behind an in-flight switch executes after it completes — never
    // interleaved with it.
    private val engineLock = Any()

    // Bumped by every START/STOP command (main thread). A queued START whose
    // sequence is stale by the time it acquires the lock was superseded by a
    // newer command and must not touch the engine.
    @Volatile
    private var commandSeq = 0

    /**
     * Set the instant `onDestroy` begins. A START worker that is mid-flight
     * when the service is destroyed must not leave an established TUN behind:
     * without this flag the worker installs a descriptor that only the dead
     * Service object references, so the interface — and the system VPN key
     * icon — survives with nothing reading it, and all traffic blackholes.
     */
    @Volatile
    private var destroyed = false

    /**
     * The system revoked our interface, so the descriptor we still hold is
     * dead. Blocks the switch fast path from reusing it — otherwise the engine
     * starts on a defunct fd, returns success, and the app reports 'connected'
     * over a tunnel that no longer exists. Cleared by the next [setupVpn].
     */
    @Volatile
    private var tunnelRevoked = false

    /**
     * Descriptors retired while the engine was still using them (see
     * [parkQuietly]). Held forever on purpose: the reference is what stops the
     * finalizer from freeing the fd number back to the process.
     */
    private val parkedDescriptors =
        java.util.Collections.synchronizedList(mutableListOf<ParcelFileDescriptor>())

    companion object {
        const val ACTION_START = "ACTION_START"
        const val ACTION_STOP = "ACTION_STOP"

        /**
         * Start from the payload stored by [QuickConnectStore] instead of one
         * carried in the intent. This is what a home-screen widget, a Quick
         * Settings tile or a shortcut uses: they run in a cold process with no
         * JS runtime, so they cannot build a config and can only replay the
         * last one that worked.
         */
        const val ACTION_START_LAST = "ACTION_START_LAST"

        const val CHANNEL_ID = "xray_vpn_channel"
        private const val TAG = "XrayVpnService"

        /**
         * Intent that tears the tunnel down. Use this from a widget or tile
         * instead of hand-writing the action string, and dispatch it with
         * `context.startService(...)` — NOT `startForegroundService`, because
         * the stop path deliberately never enters the foreground.
         */
        @JvmStatic
        fun stopIntent(context: Context): Intent =
            Intent(context, XrayVpnService::class.java).setAction(ACTION_STOP)

        /**
         * Intent that reconnects using the stored payload. Check
         * [QuickConnectStore.isReady] first: with nothing stored this reports an
         * error rather than connecting. Dispatch with
         * `ContextCompat.startForegroundService(...)` — the service enters the
         * foreground itself, and a widget tap is an accepted exemption from the
         * background-start restriction.
         */
        @JvmStatic
        fun quickConnectIntent(context: Context): Intent =
            Intent(context, XrayVpnService::class.java).setAction(ACTION_START_LAST)

        // Neutral default DNS (Cloudflare) used only when the caller does not
        // pass DNS_SERVERS. Kept out of the Google range to reduce fingerprinting.
        private val DEFAULT_DNS_SERVERS = listOf("1.1.1.1", "1.0.0.1")

        /** Deadline for the engine shutdown that gates releasing the tunnel. */
        private const val ENGINE_STOP_TIMEOUT_MS = 2_500L

        /** Дедлайн на разбор обхода, который выполняется перед движком. */
        private const val BYPASS_STOP_TIMEOUT_MS = 4_000L

        /**
         * The TUN interface is established, i.e. this app is capturing traffic.
         *
         * This tracks the INTERFACE, not the engine: it stays true across a
         * server switch (the tunnel never drops) and during a kill-switch
         * blackhole hold (the tunnel is deliberately kept up with a dead
         * engine). It used to be cleared at the top of every start and at the
         * top of teardown, which made `isVpnConnected()` report "off" while a
         * TUN was still established — the state that produced "the key icon is
         * still there, there is no network, and the app offers me Connect".
         */
        @Volatile
        var isRunning: Boolean = false

        /**
         * The Xray engine is running behind the TUN. False during a kill-switch
         * hold, which is exactly what separates "connected" from "traffic
         * blocked". Stats are only meaningful while this is true.
         */
        @Volatile
        var isEngineRunning: Boolean = false
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // START_STICKY restart after process death: no intent, no config, and
        // the system already tore our TUN down with the process. Nothing to
        // resume — exit quietly instead of emitting a spurious error.
        if (intent == null) {
            Log.i(TAG, "Restarted with null intent (sticky) — nothing to resume")
            stopSelf(startId)
            return START_NOT_STICKY
        }

        // Шина должна уметь рассылать состояние наружу: подписчик в JS один и
        // при закрытом приложении не существует, а виджету надо обновляться.
        XrayStateBus.attachContext(this)

        val action = intent.action ?: ACTION_START
        Log.i(TAG, "DIAG onStartCommand action=$action startId=$startId flags=$flags")

        if (action == ACTION_STOP) {
            Log.i(TAG, "Received STOP action")
            val mySeq = ++commandSeq
            // Captured on the main thread, before the worker queues: identifies
            // the start (if any) that THIS stop preempts. A start armed later
            // gets a newer token and is therefore immune.
            val startToken = XrayStateBus.currentStartToken()
            XrayStateBus.emit("disconnecting")
            Thread {
                synchronized(engineLock) {
                    if (mySeq != commandSeq) {
                        // A newer START arrived while we queued. Tearing down
                        // here would kill a tunnel the user just asked for.
                        Log.i(TAG, "Stop superseded (seq $mySeq != $commandSeq), skipping")
                        XrayStateBus.resolveStop()
                        return@synchronized
                    }
                    XrayStateBus.resolveStart(startToken, false, "Stopped before start completed")
                    stopBypassBounded()
                    stopEngineBounded()
                    dropTunnel()
                    XrayStateBus.emit("disconnected")
                    // Settle the JS `disconnect()` here: обход уже погашен
                    // выше, туннель снят, показывать пользователю нечего.
                    XrayStateBus.resolveStop()
                    Log.i(TAG, "DIAG calling stopSelf(startId=$startId)")
                    stopSelf(startId)
                    Log.i(TAG, "DIAG stopSelf returned")
                }
            }.start()
            return START_NOT_STICKY
        }

        // A quick-connect start carries no payload: it replays what was stored
        // on the last successful start, because whoever dispatched it (widget,
        // tile, shortcut) has no JS runtime to build a config with.
        val fromStore = action == ACTION_START_LAST
        val configJson =
            if (fromStore) QuickConnectStore.config(this)
            else intent.getStringExtra("CONFIG_JSON")
        if (configJson == null) {
            val reason =
                if (fromStore) "No stored connection to resume — open the app and connect once"
                else "No config JSON provided"
            Log.e(TAG, reason)
            XrayStateBus.emit("error", reason)
            XrayStateBus.resolveStart(XrayStateBus.currentStartToken(), false, reason)
            stopSelf(startId)
            return START_NOT_STICKY
        }

        // Optional comma-separated DNS servers for the TUN interface. Falls back
        // to a neutral default when the caller does not specify any (avoids a
        // hardcoded Google-DNS fingerprint). Actual resolution still follows the
        // Xray config's dns/routing rules.
        val dnsServers =
            if (fromStore) QuickConnectStore.dnsServers(this).ifEmpty { DEFAULT_DNS_SERVERS }
            else intent.getStringExtra("DNS_SERVERS")
                ?.split(",")
                ?.map { it.trim() }
                ?.filter { it.isNotEmpty() }
                ?: DEFAULT_DNS_SERVERS

        startForegroundService()
        XrayStateBus.emit("connecting")

        val mySeq = ++commandSeq
        val startToken = XrayStateBus.currentStartToken()
        Thread {
            synchronized(engineLock) {
                if (mySeq != commandSeq) {
                    // A newer START or a STOP arrived while we queued — that
                    // command owns the engine now.
                    Log.i(TAG, "Start superseded (seq $mySeq != $commandSeq), skipping")
                    XrayStateBus.resolveStart(startToken, false, "Superseded by a newer start/stop")
                    return@synchronized
                }
                runStart(configJson, dnsServers, mySeq, startToken, startId, fromStore)
            }
        }.start()

        return START_STICKY
    }

    /**
     * Bring the engine up, reusing the established TUN when this is a server
     * switch. Runs on a worker thread, holding [engineLock].
     */
    private fun runStart(
        configJson: String,
        dnsServers: List<String>,
        mySeq: Int,
        startToken: Int,
        startId: Int,
        /** Старт без JS: конфиг взят из [QuickConnectStore], а не из интента. */
        fromStore: Boolean = false,
    ) {
        try {
            isEngineRunning = false
            // Bounded, like every other engine stop. An unbounded one here would
            // hold [engineLock] forever, and every teardown path starts by taking
            // that lock — so a hang during a switch would make the tunnel
            // impossible to release at all, which is the exact symptom this
            // work exists to remove.
            if (XrayEngine.stopEngineBounded(ENGINE_STOP_TIMEOUT_MS) == XrayEngine.ERR_WEDGED) {
                handleStartFailure(
                    "Xray engine is not responding — restart the app",
                    startToken,
                    startId,
                )
                return
            }

            // Server switch: the interface is already up and its parameters are
            // unchanged, so reuse the SAME descriptor instead of establishing a
            // second one. The kernel interface, its routes and the system VPN
            // key icon are then provably continuous across a switch, and a
            // failing `establish()` can no longer strand the user behind a dead
            // tunnel that the kill switch then holds forever. No Go change is
            // needed: StopXray() above nils the instance, so StartXray() accepts
            // the same fd, and the app owns that fd throughout (xray-core never
            // closes it — see docs/STAGE3_ANDROID.md).
            //
            // Never reuse a revoked descriptor: the engine would start on a dead
            // fd, return success, and the app would report a healthy connection
            // over an interface the system already took away.
            // Two distinct roles, deliberately not one variable: `previous` is
            // the handle we still owe a close to, `reusable` is whether it may
            // back the new connection. Conflating them leaks the descriptor
            // whenever it is ineligible.
            val previous = tunnel.get()
            val reusable = if (tunnelRevoked) null else previous
            val tunFd = if (reusable != null && activeDnsServers == dnsServers) {
                Log.i(TAG, "Reusing established TUN (fd=${reusable.fd}) — server switch")
                reusable.fd
            } else {
                // Establish BEFORE closing the old interface: the system
                // replaces it atomically, so there is no window where traffic
                // bypasses the VPN.
                val fd = setupVpn(dnsServers)
                Log.i(TAG, "TUN interface established, fd=$fd")
                closeQuietly(previous)
                fd
            }

            // The service was destroyed while we were establishing. Nothing
            // will ever read this interface, so it must not outlive us.
            if (destroyed) {
                Log.w(TAG, "Service destroyed mid-start — dropping the tunnel")
                teardown()
                XrayStateBus.resolveStart(startToken, false, "Service destroyed before start completed")
                return
            }

            // Быстрый старт без JS: если прошлое подключение шло через обход,
            // поднимаем его ПЕРЕД движком. Конфиг xray в этом режиме дозванивается
            // на 127.0.0.1:<socks>, а этот порт существует, только пока работает
            // olcrtc. Иначе туннель встанет и будет тихо молчать.
            //
            // startBypass синхронный и сам ждёт готовности SOCKS, так что ничего
            // дополнительно ждать не нужно. Если обход уже поднят (например,
            // виджет нажали дважды), повторно не трогаем.
            // Восстанавливаем описание подключения: клиент стирает его при
            // отключении, а здесь JS нет и записать заново некому. Без этого
            // уведомление после старта с виджета остаётся безымянным.
            if (fromStore) QuickConnectStore.restoreConnectionInfo(this)

            if (fromStore && !XrayEngine.isBypassRunning()) {
                val storedOlcrtc = QuickConnectStore.olcrtcConfig(this)
                if (storedOlcrtc != null) {
                    Log.i(TAG, "Quick connect: starting bypass before the engine")
                    val bypassResult = XrayEngine.startBypass(storedOlcrtc)
                    if (bypassResult != 0) {
                        handleStartFailure(
                            "Bypass failed to start with code: $bypassResult",
                            startToken,
                            startId,
                        )
                        return
                    }
                }
            }

            Log.i(TAG, "Starting XrayEngine...")
            val result = XrayEngine.startEngine(configJson, tunFd)
            if (result != 0) {
                handleStartFailure("XrayEngine failed to start with code: $result", startToken, startId)
                return
            }

            isEngineRunning = true
            // A STOP that landed while the engine was starting must still win:
            // resolve the start as superseded and let the queued STOP tear
            // down. Re-checked here because the only prior check was before
            // `establish()`, and both calls above can take seconds.
            if (mySeq != commandSeq || destroyed) {
                Log.i(TAG, "Start superseded after engine start (seq $mySeq != $commandSeq)")
                XrayStateBus.resolveStart(startToken, false, "Superseded by a newer start/stop")
                if (destroyed) teardown()
                return
            }
            // Only a payload that actually started the engine is worth storing:
            // a widget must never be able to replay a config already known to
            // fail. No-op unless the consumer opted in.
            //
            // Конфиг обхода сохраняется ВМЕСТЕ с конфигом xray: без него
            // воспроизведение подняло бы туннель в мёртвый прокси. Быстрый старт
            // выше поднимает обход первым, поэтому пара воспроизводима целиком.
            QuickConnectStore.save(this, configJson, dnsServers, XrayEngine.lastBypassConfig())
            updateNotification(NotificationConfigStore.applyConnection(this, NotificationConfigStore.text(this)))
            XrayStateBus.emit("connected")
            XrayStateBus.resolveStart(startToken, true, null)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start VPN", e)
            handleStartFailure(e.message ?: "Failed to start VPN", startToken, startId)
        }
    }

    /**
     * The system revoked our VPN (user enabled another VPN or killed it in
     * settings). The TUN is gone regardless of the kill switch — the only
     * honest move is to stop and tell JS.
     */
    override fun onRevoke() {
        Log.w(TAG, "VPN revoked by system")
        // A revoke is a statement of fact from the system, not a queued command,
        // so it is never "superseded": the interface is gone either way. Bumping
        // the sequence is enough to make a racing START lose, and marking the
        // descriptor revoked stops the switch fast path from reusing a dead fd
        // and reporting a healthy 'connected' over a tunnel that no longer exists.
        commandSeq++
        tunnelRevoked = true
        Thread {
            synchronized(engineLock) {
                teardown()
                XrayStateBus.emit("disconnected", "VPN revoked by system")
                XrayStateBus.resolveStop()
                stopSelf()
            }
        }.start()
    }

    /**
     * Engine failed to start. With the kill switch ON and a tunnel
     * established, keep the TUN up: routes stay claimed and all traffic
     * blackholes instead of leaking onto the open network. The user exits
     * this state via an explicit STOP (or a successful reconnect).
     *
     * The hold is deliberately NOT timed out — releasing the tunnel on a timer
     * would put the user's traffic back on the open network, which is the one
     * thing the kill switch exists to prevent. What it does instead is report
     * a distinct `blocked` state, so the UI can say "traffic is blocked" and
     * offer Disconnect. Reporting this as plain `error` (with `isRunning`
     * cleared, as it used to be) left the app showing "disconnected" over a
     * live blackhole, with no way for the user to release it.
     */
    private fun handleStartFailure(msg: String, startToken: Int, startId: Int) {
        val killSwitch = KillSwitchStore.get(this)
        if (killSwitch && tunnel.get() != null && !tunnelRevoked && !destroyed) {
            Log.w(TAG, "$msg — kill switch active, holding TUN (blackhole)")
            isEngineRunning = false
            updateNotification(NotificationConfigStore.blockedText(this))
            val detail = "$msg (kill switch active: traffic blocked)"
            XrayStateBus.emit("blocked", detail)
            XrayStateBus.resolveStart(startToken, false, detail)
            // Service stays foreground, TUN stays established.
        } else {
            Log.e(TAG, msg)
            XrayStateBus.emit("error", msg)
            XrayStateBus.resolveStart(startToken, false, msg)
            teardown()
            stopSelf(startId)
        }
    }

    private fun closeQuietly(pfd: ParcelFileDescriptor?) {
        if (pfd == null) return
        try {
            pfd.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing VPN interface", e)
        }
    }

    private fun setupVpn(dnsServers: List<String>): Int {
        val builder = Builder()
        builder.setSession("Xray-core VPN")
        builder.setMtu(1500)
        builder.addAddress("10.0.0.2", 32)
        // An IPv6 address to match the ::/0 route below. Claiming that route
        // without a v6 source address is a blackhole: the system hands IPv6
        // traffic to an interface that cannot originate it, so on a dual-stack
        // network some destinations simply stop working while the tunnel looks
        // healthy. Guarded — a device without IPv6 support just keeps the
        // previous v4-only behaviour.
        try {
            builder.addAddress("fd00::2", 128)
        } catch (e: Exception) {
            Log.w(TAG, "Could not add IPv6 address: ${e.message}")
        }
        dnsServers.forEach { builder.addDnsServer(it) }
        builder.addRoute("0.0.0.0", 0)       // Route all IPv4 traffic
        builder.addRoute("::", 0)             // Route all IPv6 traffic

        // Exclude our own app to prevent routing loop
        try {
            builder.addDisallowedApplication(packageName)
        } catch (e: Exception) {
            Log.w(TAG, "Could not disallow self: ${e.message}")
        }

        val pfd = builder.establish()
            ?: throw IllegalStateException("VpnService.Builder.establish() returned null. Was VPN permission granted?")

        activeDnsServers = dnsServers
        tunnel.set(pfd)
        tunnelRevoked = false
        isRunning = true
        return pfd.fd
    }

    /**
     * Drop the tunnel — the entire user-visible part of a teardown, and the
     * only part that has to be fast.
     *
     * Closing the descriptor is what actually removes the interface and the
     * system VPN key icon, so this is the only part of a teardown the user can
     * see, and the only part that has to be quick.
     *
     * It MUST run after [stopEngineBounded]. xray-core's Android tun inbound is
     * built on gvisor's fdbased endpoint, which explicitly does not take
     * ownership of the descriptor and keeps issuing readv/writev on that raw fd
     * NUMBER until the endpoint is detached and its Wait() returns — reachable
     * only from the engine's own Close(). Closing first would hand a live
     * reader/writer a number the process is free to reassign to the next
     * socket. (The repo's older note that "the app owns the fd" is about who
     * CLOSES it, not about when it stops being used.)
     *
     * Safe to call from any thread and any number of times: the descriptor is
     * claimed with an atomic swap, so exactly one caller closes it.
     */
    private fun dropTunnel() {
        val pfd = tunnel.getAndSet(null)
        activeDnsServers = null
        isRunning = false
        isEngineRunning = false
        Log.i(TAG, "DIAG dropTunnel pfd=" + (pfd?.fd?.toString() ?: "none") + " wedged=" + XrayEngine.isWedged)
        if (pfd != null) {
            // Зависший движок продолжает крутиться на этом НОМЕРЕ fd. Обычный
            // close вернул бы номер процессу, и следующий открытый сокет
            // унаследовал бы его. Паркуем: dup2 отдаёт номер /dev/null, который
            // поглощает чужой ввод-вывод.
            if (XrayEngine.isWedged) parkQuietly(pfd) else closeQuietly(pfd)
        }
        try {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        } catch (e: Exception) {
            Log.w(TAG, "Error clearing foreground state", e)
        }
        Log.i(TAG, "Tunnel dropped")
    }

    /**
     * Retire a descriptor the engine has not finished with: point its number at
     * /dev/null and keep the [ParcelFileDescriptor] referenced forever, so
     * nothing — not a later close, not the finalizer — ever returns the number
     * to the process. Only reachable once the engine is wedged, which already
     * means this process needs restarting.
     */
    private fun parkQuietly(pfd: ParcelFileDescriptor) {
        try {
            val sink = android.system.Os.open(
                "/dev/null",
                android.system.OsConstants.O_RDWR,
                0,
            )
            try {
                android.system.Os.dup2(sink, pfd.fd)
            } finally {
                android.system.Os.close(sink)
            }
            parkedDescriptors.add(pfd)
            Log.e(TAG, "Engine wedged — parked tun fd=${pfd.fd} on /dev/null")
        } catch (e: Throwable) {
            Log.w(TAG, "Could not park tun fd — closing it instead", e)
            closeQuietly(pfd)
        }
    }

    /**
     * Stop the Xray engine, with a deadline.
     *
     * The tunnel cannot be released until this returns (see [dropTunnel]), so
     * the engine shutdown sits directly in front of the user-visible part of a
     * disconnect. It is normally fast, but a tun reader that never wakes would
     * otherwise translate straight into the reported symptom: the VPN key icon
     * stays in the status bar and the network is dead with no way out.
     *
     * On timeout [XrayEngine] marks itself wedged and the tunnel is released
     * regardless — with the descriptor parked rather than closed, so the stuck
     * reader cannot end up on someone else's socket.
     */
    private fun stopEngineBounded() {
        isEngineRunning = false
        val r = XrayEngine.stopEngineBounded(ENGINE_STOP_TIMEOUT_MS)
        Log.i(TAG, "DIAG stopEngineBounded -> $r")
    }

    /**
     * Stop the olcrtc side-channel, on its own detached thread.
     *
     * Its WebRTC teardown can take seconds and nothing user-visible depends on
     * it, so it must not sit inside [engineLock]: holding that lock for the
     * length of a WebRTC shutdown makes a Connect tapped right after a
     * Disconnect wait it out, which is precisely the cost d3da6ef removed.
     * [XrayEngine.stopBypass] serializes and coalesces on the Go side, so
     * firing it detached is safe even if the app asks for one too.
     *
     * olcrtc must not outlive the tunnel (battery/privacy), so it is never
     * simply skipped.
     */
    /**
     * Погасить обход ДО остановки движка, с дедлайном.
     *
     * Порядок важен: пока olcrtc жив, горутины tun-инбаунда xray-core не
     * разматываются, и Go продолжает держать собственную копию дескриптора
     * туннеля. Интерфейс из-за этого не исчезает, netd молчит, система не
     * отвязывается от сервиса, и замок висит десятками секунд. На чистом VLESS,
     * где обход не поднимался, тот же сценарий снимает замок за три секунды.
     */
    private fun stopBypassBounded() {
        val worker = Thread {
            try {
                XrayEngine.stopBypass()
            } catch (e: Throwable) {
                Log.w(TAG, "Error stopping olcrtc", e)
            }
        }
        worker.name = "olcrtc-stop"
        worker.isDaemon = true
        worker.start()
        worker.join(BYPASS_STOP_TIMEOUT_MS)
        if (worker.isAlive) {
            Log.w(TAG, "olcrtc did not stop within ${BYPASS_STOP_TIMEOUT_MS}ms — continuing")
        }
    }

    private fun stopBypassDetached() {
        val worker = Thread {
            try {
                XrayEngine.stopBypass()
            } catch (e: Throwable) {
                Log.w(TAG, "Error stopping olcrtc", e)
            }
            Log.i(TAG, "olcrtc teardown finished")
        }
        worker.name = "olcrtc-stop"
        // Daemon: измерено на Pixel 9 / Android 17. После минуты работы обхода
        // teardown olcrtc растягивается на десятки секунд, и пока этот поток
        // жив, сервис не уничтожается — а замок в шторке снимается именно с
        // уничтожением сервиса, не с закрытием дескриптора. Тот же сценарий на
        // чистом VLESS, где olcrtc не поднимался, снимает замок за 3 секунды.
        // Демон не удерживает процесс и не мешает сервису умереть; олькртк
        // всё равно уже отвязан от туннеля, дотекать ему некуда.
        worker.isDaemon = true
        worker.start()
    }

    /**
     * Full teardown in the only safe order: engine (bounded) → descriptor +
     * notification → olcrtc (detached). Never call it on the main thread.
     */
    private fun teardown() {
        stopBypassBounded()
        stopEngineBounded()
        dropTunnel()
        Log.i(TAG, "VPN stopped")
    }

    /** PendingIntent that stops the VPN — backs the notification's Disconnect button. */
    private fun disconnectPendingIntent(): android.app.PendingIntent {
        val intent = Intent(this, XrayVpnService::class.java).setAction(ACTION_STOP)
        var flags = android.app.PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags = flags or android.app.PendingIntent.FLAG_IMMUTABLE
        }
        return android.app.PendingIntent.getService(this, 0, intent, flags)
    }

    private fun buildNotification(text: String): Notification {
        val title = NotificationConfigStore.title(this)
        val disconnectLabel = NotificationConfigStore.disconnectLabel(this)
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(true)
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                disconnectLabel,
                disconnectPendingIntent(),
            )
            .build()
    }

    /** Refresh the foreground notification text (e.g. held-blackhole state). */
    private fun updateNotification(text: String) {
        try {
            getSystemService(NotificationManager::class.java)
                ?.notify(1, buildNotification(text))
        } catch (e: Exception) {
            Log.w(TAG, "Could not update notification", e)
        }
    }

    private fun startForegroundService() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                NotificationConfigStore.channelName(this),
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }

        val notification = buildNotification(
            NotificationConfigStore.applyConnection(this, NotificationConfigStore.text(this)),
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) { // Android 14
            ServiceCompat.startForeground(
                this,
                1,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(1, notification)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        // Runs on the MAIN thread, so nothing blocking may happen here. The
        // descriptor cannot be closed before the engine stops (see dropTunnel),
        // and stopping the engine is blocking, so the WHOLE teardown goes to a
        // worker. The descriptor lives in a field the worker reads, so it is
        // still closed even though this Service object is already gone, and
        // [destroyed] stops an in-flight START from installing a fresh tunnel
        // behind our back.
        destroyed = true
        val hadTunnel = isRunning || tunnel.get() != null
        Thread {
            synchronized(engineLock) { teardown() }
            // Settled only once the descriptor is genuinely closed: a JS
            // disconnect() that was in flight when the service died must not be
            // told "the tunnel is down" while it is still up.
            XrayStateBus.resolveStop()
        }.start()
        // If the service was torn down without an explicit STOP (system kill or
        // task swipe), surface a disconnected state to JS. A held blackhole
        // counts as "had a tunnel": after destruction traffic flows in the open,
        // so JS must not stay stuck on 'blocked'.
        if (hadTunnel) {
            XrayStateBus.emit("disconnected")
        }
        Log.i(TAG, "XrayVpnService destroyed")
    }
}
