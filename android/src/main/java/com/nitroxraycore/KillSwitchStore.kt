package com.nitroxraycore

import android.content.Context

/**
 * Persisted kill-switch flag, shared between [XrayVpnService] (enforcement)
 * and the Nitro hybrid (JS API). SharedPreferences so the setting survives
 * app and service restarts.
 */
object KillSwitchStore {
    private const val PREFS = "nitro_xray_core"
    private const val KEY_ENABLED = "kill_switch_enabled"

    fun set(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_ENABLED, enabled)
            .apply()
    }

    fun get(context: Context): Boolean {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_ENABLED, false)
    }
}
