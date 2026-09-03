package com.nitroxraycore

/**
 * Process-wide bridge between [XrayVpnService] (which runs the engine on its
 * own thread) and [HybridNitroXrayCore] (which talks to JS).
 *
 * - [listener] is the single JS state callback; the TS wrapper fans it out to
 *   any number of subscribers.
 * - [setPendingStart] / [resolveStart] settle the in-flight `startXray` call,
 *   so the Promise resolves only after the engine actually starts (or rejects
 *   with the real error).
 * - [setPendingStop] / [resolveStop] do the same for `stopXray`, so
 *   `await disconnect()` means "the tunnel is down", not "the intent was sent".
 *
 * Every start carries a token. A command that wants to settle a start must
 * present the token that was armed when *it* was dispatched: without that, a
 * STOP queued behind a slow START would reject the promise of a NEWER start
 * that was armed after the STOP was sent, and JS would see
 * "Stopped before start completed" while a tunnel was in fact coming up.
 */
object XrayStateBus {
    @Volatile
    var listener: ((state: String, message: String) -> Unit)? = null

    private val lock = Any()

    private var pendingStart: ((success: Boolean, error: String?) -> Unit)? = null
    private var pendingStartToken = 0
    private var startTokenSeq = 0

    private var pendingStop: (() -> Unit)? = null

    /**
     * Контекст приложения для широковещательных уведомлений о состоянии.
     * Ставится сервисом при старте; до этого рассылать некуда и незачем.
     */
    @Volatile
    private var appContext: android.content.Context? = null

    fun attachContext(context: android.content.Context) {
        appContext = context.applicationContext
    }

    /**
     * Действие, по которому точки входа БЕЗ JS узнают о смене состояния.
     *
     * Слушатель [listener] один и занят мостом в JS. Виджету, плитке или
     * ярлыку подписаться некуда, а при закрытом приложении JS вообще не
     * выполняется: туннель, поднятый с виджета, менял состояние, и обновить
     * подпись было некому. Широковещание решает это без второго слушателя —
     * ресивер объявлен в манифесте и переживает мёртвый процесс JS.
     *
     * Привязано к applicationId: сборки разных брендов стоят на устройстве
     * рядом, и общая строка означала бы, что состояние одного бренда прилетает
     * ресиверу другого.
     */
    fun stateAction(context: android.content.Context): String =
        "${context.packageName}.XRAY_STATE_CHANGED"

    fun emit(state: String, message: String = "") {
        listener?.invoke(state, message)
        val ctx = appContext ?: return
        try {
            ctx.sendBroadcast(
                android.content.Intent(stateAction(ctx))
                    .setPackage(ctx.packageName)
                    .putExtra("state", state),
            )
        } catch (e: Throwable) {
            android.util.Log.w("XrayStateBus", "Failed to broadcast state", e)
        }
    }

    /**
     * Token identifying the start that is currently armed, or 0 when none is.
     * Read on the main thread in `onStartCommand` so a worker can later tell
     * whether the start it was dispatched alongside is still the current one.
     */
    fun currentStartToken(): Int = synchronized(lock) { pendingStartToken }

    /**
     * Arm the one-shot start completion before launching the service.
     * If a previous start is still pending, it is settled as superseded —
     * otherwise its JS Promise would hang forever.
     */
    fun setPendingStart(cb: (success: Boolean, error: String?) -> Unit): Int {
        var previous: ((success: Boolean, error: String?) -> Unit)? = null
        var token = 0
        synchronized(lock) {
            previous = pendingStart
            token = ++startTokenSeq
            pendingStart = cb
            pendingStartToken = token
        }
        previous?.invoke(false, "Superseded by a newer start")
        return token
    }

    /**
     * Settle the armed start exactly once — but only when [token] still
     * identifies it. A stale token means a newer start was armed in the
     * meantime, and this caller has no business settling it.
     */
    fun resolveStart(token: Int, success: Boolean, error: String?) {
        var cb: ((success: Boolean, error: String?) -> Unit)? = null
        synchronized(lock) {
            if (pendingStart != null && token == pendingStartToken) {
                cb = pendingStart
                pendingStart = null
                pendingStartToken = 0
            }
        }
        cb?.invoke(success, error)
    }

    /** Arm the one-shot stop completion before dispatching ACTION_STOP. */
    fun setPendingStop(cb: () -> Unit) {
        var previous: (() -> Unit)? = null
        synchronized(lock) {
            previous = pendingStop
            pendingStop = cb
        }
        // Two disconnects in flight: settle the older one rather than hang it.
        previous?.invoke()
    }

    /**
     * Fire the pending stop completion exactly once. Called by the service the
     * moment the tunnel is actually down and the notification is gone — before
     * the slow engine/olcrtc shutdown, which nothing user-visible waits on.
     */
    fun resolveStop() {
        var cb: (() -> Unit)? = null
        synchronized(lock) {
            cb = pendingStop
            pendingStop = null
        }
        cb?.invoke()
    }
}
