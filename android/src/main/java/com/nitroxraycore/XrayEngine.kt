package com.nitroxraycore

import android.util.Log
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * JNI surface of libxray.so.
 *
 * Every mutating Go entry point here writes a package-level global on the Go
 * side (`runningServer` in main.go, the olcrtc client + its SOCKS port in
 * olcrtc.go) and NONE of them is guarded by a mutex there. They are reachable
 * from at least three threads at once — the service's START/STOP workers,
 * `onDestroy`'s shutdown worker, and JS calls arriving on the Nitro dispatcher —
 * so the serialization has to live somewhere, and here is the only place that
 * covers all callers.
 *
 * Two locks, not one, on purpose: [startBypass] blocks until the WebRTC SOCKS
 * listener is ready (tens of seconds on a bad link), and it must never be able
 * to hold up an xray teardown.
 *
 * Nothing here waits forever. A cgo call that never returns would otherwise own
 * its lock for the life of the process and turn every later call into a silent
 * hang — which is how a wedged engine becomes a VPN key icon that never clears
 * and a Connect button that spins until the app is killed. Instead the engine
 * is marked [isWedged] and every subsequent call fails fast with a real error
 * the UI can show.
 *
 * The synchronous readers ([version], [isBypassRunning], [bypassSocksPort]) run
 * on the JS thread, so they never block at all: the version is a compile-time
 * constant and is cached, and the olcrtc readers take the lock only if it is
 * free, otherwise returning the last observed value.
 */
object XrayEngine {
    private val TAG = "XrayEngine"

    /** A previous call never returned; the engine needs a fresh process. */
    const val ERR_WEDGED = -101

    /** The lock could not be acquired in time — another call is still running. */
    const val ERR_BUSY = -102

    /** How long a caller waits for a lock before giving up rather than hanging. */
    private const val LOCK_WAIT_MS = 3_000L

    /** Guards Go's `runningServer`: start / stop / stats. */
    private val xrayLock = ReentrantLock()

    /** Guards Go's olcrtc client and its SOCKS port. */
    private val olcrtcLock = ReentrantLock()

    /**
     * Set when a Go call blew its deadline. The thread that made it is parked
     * inside cgo holding [xrayLock] and will never release it, so every later
     * engine call must refuse instead of joining it there.
     */
    @Volatile
    var isWedged = false
        private set

    @Volatile
    private var bypassRunning = false

    @Volatile
    private var bypassPort = 0

    /** Xray-core's version is a compile-time constant, so one read is enough. */
    @Volatile
    private var cachedVersion: String? = null

    init {
        try {
            System.loadLibrary("xray")
            Log.i(TAG, "libxray.so loaded successfully")
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to load libxray.so", e)
        }
        try {
            System.loadLibrary("NitroXrayCore")
            Log.i(TAG, "NitroXrayCore loaded successfully")
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to load NitroXrayCore", e)
        }
    }

    // --- raw JNI bindings ---------------------------------------------------
    // Private so nothing can reach the Go globals unserialized. The JNI symbol
    // is derived from the function name, so these names must keep matching
    // android/src/main/cpp/cpp-adapter.cpp regardless of visibility.

    private external fun start(configJson: String, tunFd: Int): Int
    private external fun stop(): Int
    private external fun getVersion(): String
    private external fun queryStats(outboundTag: String): String
    private external fun startOlcrtc(configJson: String): Int
    private external fun stopOlcrtc(): Int
    private external fun getOlcrtcSocksPort(): Int
    private external fun isOlcrtcRunning(): Int

    // --- engine -------------------------------------------------------------

    /** Start the engine on [tunFd]. Refuses (returns -1) if one is already running. */
    fun startEngine(configJson: String, tunFd: Int): Int {
        if (isWedged) return ERR_WEDGED
        if (!xrayLock.tryLock(LOCK_WAIT_MS, TimeUnit.MILLISECONDS)) return ERR_BUSY
        try {
            return start(configJson, tunFd)
        } finally {
            xrayLock.unlock()
        }
    }

    /**
     * Stop the engine, giving up after [timeoutMs].
     *
     * The tunnel descriptor cannot be released until this returns (gvisor's
     * fdbased endpoint keeps using the raw fd number until the engine detaches
     * it), so this call sits directly in front of the user-visible part of a
     * disconnect. On timeout the engine is marked [isWedged] and the caller is
     * released: a process that can no longer stop its engine still has to be
     * able to give the user their network back.
     */
    fun stopEngineBounded(timeoutMs: Long): Int {
        if (isWedged) return ERR_WEDGED
        val result = AtomicInteger(ERR_BUSY)
        val worker = Thread {
            if (!xrayLock.tryLock(LOCK_WAIT_MS, TimeUnit.MILLISECONDS)) return@Thread
            try {
                result.set(stop())
            } catch (e: Throwable) {
                Log.w(TAG, "Error stopping engine", e)
            } finally {
                xrayLock.unlock()
            }
        }
        worker.name = "xray-engine-stop"
        worker.start()
        worker.join(timeoutMs)
        if (worker.isAlive) {
            isWedged = true
            Log.e(TAG, "Engine stop did not return within ${timeoutMs}ms — engine marked wedged")
            return ERR_WEDGED
        }
        return result.get()
    }

    /** JSON `{"uplink":N,"downlink":N}` for the given outbound tag. */
    fun stats(outboundTag: String): String {
        if (isWedged) throw IllegalStateException("engine wedged")
        if (!xrayLock.tryLock(LOCK_WAIT_MS, TimeUnit.MILLISECONDS)) {
            throw IllegalStateException("engine busy")
        }
        try {
            return queryStats(outboundTag)
        } finally {
            xrayLock.unlock()
        }
    }

    // --- olcrtc -------------------------------------------------------------

    /**
     * Start the olcrtc side-channel. Blocks until its SOCKS listener is ready
     * or the ready timeout elapses. Returns 0 on success, negative on error
     * (-1 config parse, -2 start failed, -3 not ready).
     */
    /**
     * Конфиг последнего успешно поднятого обхода.
     *
     * Нужен точке входа БЕЗ JS — виджету, плитке, ярлыку. Она воспроизводит
     * сохранённый конфиг xray, а тот в режиме обхода ссылается на
     * 127.0.0.1:<socks>, живущий лишь пока работает olcrtc. Значит быстрый
     * старт обязан поднять обход первым, а построить его конфиг сам он не
     * может — только повторить последний рабочий.
     */
    @Volatile
    private var lastBypassConfig: String? = null

    fun lastBypassConfig(): String? = lastBypassConfig

    fun startBypass(configJson: String): Int = olcrtcLock.withLock {
        val result = startOlcrtc(configJson)
        bypassRunning = isOlcrtcRunning() != 0
        bypassPort = getOlcrtcSocksPort()
        if (result == 0 && bypassRunning) lastBypassConfig = configJson
        result
    }

    /**
     * Stop the olcrtc side-channel.
     *
     * Coalesces rather than queues: a stop already in flight produces exactly
     * the outcome a second caller wants, so waiting behind it would only put
     * the multi-second WebRTC teardown in front of whoever asked second — in
     * practice the app's own `disconnect()`, right after the service started
     * one. The mirrors are published pessimistically before the call so no
     * reader sees a stale "running" while a stop is underway.
     */
    fun stopBypass(): Int {
        if (!olcrtcLock.tryLock()) {
            Log.i(TAG, "olcrtc stop already in flight — coalescing")
            return 0
        }
        try {
            bypassRunning = false
            bypassPort = 0
            val result = stopOlcrtc()
            bypassRunning = isOlcrtcRunning() != 0
            bypassPort = getOlcrtcSocksPort()
            return result
        } finally {
            olcrtcLock.unlock()
        }
    }

    // --- non-blocking readers -----------------------------------------------

    /** Xray-core version string. Constant, so it is read once and cached. */
    fun version(): String {
        cachedVersion?.let { return it }
        val v = getVersion()
        cachedVersion = v
        return v
    }

    /** Whether the olcrtc client is running. */
    fun isBypassRunning(): Boolean {
        refreshBypassStateIfFree()
        return bypassRunning
    }

    /** Local SOCKS5 port olcrtc listens on, or 0 if not running. */
    fun bypassSocksPort(): Int {
        refreshBypassStateIfFree()
        return bypassPort
    }

    /**
     * Re-read olcrtc's Go state, but only when no mutation holds the lock. A
     * blocking read here would stall the JS thread for the length of a WebRTC
     * teardown; while a mutation IS in flight the published mirrors are the
     * truthful answer, because [stopBypass] clears them before it starts.
     */
    private fun refreshBypassStateIfFree() {
        if (!olcrtcLock.tryLock()) return
        try {
            bypassRunning = isOlcrtcRunning() != 0
            bypassPort = getOlcrtcSocksPort()
        } catch (e: Throwable) {
            Log.w(TAG, "Failed to refresh olcrtc state", e)
        } finally {
            olcrtcLock.unlock()
        }
    }
}
