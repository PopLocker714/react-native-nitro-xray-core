package com.nitroxraycore

/**
 * Process-wide bridge between [XrayVpnService] (which runs the engine on its
 * own thread) and [HybridNitroXrayCore] (which talks to JS).
 *
 * - [listener] is the single JS state callback; the TS wrapper fans it out to
 *   any number of subscribers.
 * - [pendingStart] is a one-shot completion for the in-flight `startXray` call,
 *   so the Promise resolves only after the engine actually starts (or rejects
 *   with the real error).
 */
object XrayStateBus {
    @Volatile
    var listener: ((state: String, message: String) -> Unit)? = null

    @Volatile
    private var pendingStart: ((success: Boolean, error: String?) -> Unit)? = null

    fun emit(state: String, message: String = "") {
        listener?.invoke(state, message)
    }

    /**
     * Arm the one-shot start completion before launching the service.
     * If a previous start is still pending, it is settled as superseded —
     * otherwise its JS Promise would hang forever.
     */
    fun setPendingStart(cb: (success: Boolean, error: String?) -> Unit) {
        val previous = pendingStart
        pendingStart = cb
        previous?.invoke(false, "Superseded by a newer start")
    }

    /** Fire the pending start completion exactly once, then clear it. */
    fun resolveStart(success: Boolean, error: String?) {
        val cb = pendingStart
        pendingStart = null
        cb?.invoke(success, error)
    }
}
