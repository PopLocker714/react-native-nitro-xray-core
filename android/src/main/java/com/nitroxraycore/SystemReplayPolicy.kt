package com.nitroxraycore

/** Pure policy: a sticky restart alone is never evidence of system Always-on. */
internal object SystemReplayPolicy {
    const val SYSTEM_ACTION = "android.net.VpnService"
    fun isSystemRequest(action: String?, nullIntent: Boolean): Boolean =
        nullIntent || action == SYSTEM_ACTION

    fun allows(action: String?, nullIntent: Boolean, sdk: Int, alwaysOn: Boolean, replayReady: Boolean): Boolean {
        if (!replayReady || !isSystemRequest(action, nullIntent) || sdk < 24) return false
        return if (sdk >= 29) alwaysOn else !nullIntent && action == SYSTEM_ACTION
    }
}
