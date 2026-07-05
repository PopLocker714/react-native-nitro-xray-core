package com.nitroxraycore

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.app.ServiceCompat

class XrayVpnService : VpnService() {
    // Written on worker threads (under engineLock), read on the main thread
    // in onDestroy — @Volatile for cross-thread visibility.
    @Volatile
    private var vpnInterface: ParcelFileDescriptor? = null

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

    companion object {
        const val ACTION_START = "ACTION_START"
        const val ACTION_STOP = "ACTION_STOP"
        const val CHANNEL_ID = "xray_vpn_channel"
        private const val TAG = "XrayVpnService"

        // Neutral default DNS (Cloudflare) used only when the caller does not
        // pass DNS_SERVERS. Kept out of the Google range to reduce fingerprinting.
        private val DEFAULT_DNS_SERVERS = listOf("1.1.1.1", "1.0.0.1")

        @Volatile
        var isRunning: Boolean = false
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // START_STICKY restart after process death: no intent, no config, and
        // the system already tore our TUN down with the process. Nothing to
        // resume — exit quietly instead of emitting a spurious error.
        if (intent == null) {
            Log.i(TAG, "Restarted with null intent (sticky) — nothing to resume")
            stopSelf()
            return START_NOT_STICKY
        }

        val action = intent.action ?: ACTION_START

        if (action == ACTION_STOP) {
            Log.i(TAG, "Received STOP action")
            commandSeq++
            XrayStateBus.emit("disconnecting")
            Thread {
                synchronized(engineLock) {
                    stopVpn()
                    // Settle any still-pending start so its Promise never hangs.
                    XrayStateBus.resolveStart(false, "Stopped before start completed")
                    XrayStateBus.emit("disconnected")
                    stopSelf()
                }
            }.start()
            return START_NOT_STICKY
        }

        val configJson = intent.getStringExtra("CONFIG_JSON")
        if (configJson == null) {
            Log.e(TAG, "No config JSON provided")
            XrayStateBus.emit("error", "No config JSON provided")
            XrayStateBus.resolveStart(false, "No config JSON provided")
            stopSelf()
            return START_NOT_STICKY
        }

        // Optional comma-separated DNS servers for the TUN interface. Falls back
        // to a neutral default when the caller does not specify any (avoids a
        // hardcoded Google-DNS fingerprint). Actual resolution still follows the
        // Xray config's dns/routing rules.
        val dnsServers = intent.getStringExtra("DNS_SERVERS")
            ?.split(",")
            ?.map { it.trim() }
            ?.filter { it.isNotEmpty() }
            ?: DEFAULT_DNS_SERVERS

        startForegroundService()
        XrayStateBus.emit("connecting")

        val mySeq = ++commandSeq
        Thread {
            synchronized(engineLock) {
                if (mySeq != commandSeq) {
                    // A newer START or a STOP arrived while we queued — that
                    // command owns the engine now.
                    Log.i(TAG, "Start superseded (seq $mySeq != $commandSeq), skipping")
                    XrayStateBus.resolveStart(false, "Superseded by a newer start/stop")
                    return@synchronized
                }
                // Keep a handle on the previous tunnel: on a server switch we
                // establish the NEW interface first (the system replaces the
                // old one atomically — no window where traffic bypasses the
                // VPN), and on failure the kill switch can keep it as a
                // blackhole.
                val previousInterface = vpnInterface
                try {
                    isRunning = false
                    XrayEngine.stop() // Stop any previous engine instance

                    val tunFd = setupVpn(dnsServers)
                    Log.i(TAG, "TUN interface established, fd=$tunFd")
                    closeQuietly(previousInterface)

                    Log.i(TAG, "Starting XrayEngine...")
                    val result = XrayEngine.start(configJson, tunFd)
                    if (result == 0) {
                        isRunning = true
                        updateNotification(NotificationConfigStore.text(this))
                        XrayStateBus.emit("connected")
                        XrayStateBus.resolveStart(true, null)
                    } else {
                        handleStartFailure("XrayEngine failed to start with code: $result")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to start VPN", e)
                    handleStartFailure(e.message ?: "Failed to start VPN")
                }
            }
        }.start()

        return START_STICKY
    }

    /**
     * The system revoked our VPN (user enabled another VPN or killed it in
     * settings). The TUN is gone regardless of the kill switch — the only
     * honest move is to stop and tell JS.
     */
    override fun onRevoke() {
        Log.w(TAG, "VPN revoked by system")
        commandSeq++
        Thread {
            synchronized(engineLock) {
                stopVpn()
                XrayStateBus.emit("disconnected", "VPN revoked by system")
                stopSelf()
            }
        }.start()
    }

    /**
     * Engine failed to start. With the kill switch ON and a tunnel
     * established, keep the TUN up: routes stay claimed and all traffic
     * blackholes instead of leaking onto the open network. The user exits
     * this state via an explicit STOP (or a successful reconnect).
     */
    private fun handleStartFailure(msg: String) {
        val killSwitch = KillSwitchStore.get(this)
        if (killSwitch && vpnInterface != null) {
            Log.w(TAG, "$msg — kill switch active, holding TUN (blackhole)")
            updateNotification(NotificationConfigStore.blockedText(this))
            XrayStateBus.emit("error", "$msg (kill switch active: traffic blocked)")
            XrayStateBus.resolveStart(false, "$msg (kill switch active: traffic blocked)")
            // Service stays foreground, TUN stays established.
        } else {
            Log.e(TAG, msg)
            XrayStateBus.emit("error", msg)
            XrayStateBus.resolveStart(false, msg)
            stopVpn()
            stopSelf()
        }
    }

    private fun closeQuietly(pfd: ParcelFileDescriptor?) {
        if (pfd == null) return
        try {
            pfd.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing previous VPN interface", e)
        }
    }

    private fun setupVpn(dnsServers: List<String>): Int {
        val builder = Builder()
        builder.setSession("Xray-core VPN")
        builder.setMtu(1500)
        builder.addAddress("10.0.0.2", 32)
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

        vpnInterface = pfd
        return pfd.fd
    }

    private fun stopVpn() {
        isRunning = false
        XrayEngine.stop()
        try {
            vpnInterface?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing VPN interface", e)
        }
        vpnInterface = null
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

        val notification = buildNotification(NotificationConfigStore.text(this))

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
        // If the service is torn down without an explicit STOP (e.g. system kill
        // or task swipe), surface a disconnected state to JS. Held-blackhole
        // counts as "had a tunnel": after destruction the TUN is gone and
        // traffic flows in the open — JS must not stay stuck on 'error'.
        val hadTunnel = isRunning || vpnInterface != null
        stopVpn()
        if (hadTunnel) {
            XrayStateBus.emit("disconnected")
        }
        Log.i(TAG, "XrayVpnService destroyed")
    }
}
