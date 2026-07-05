package com.nitroxraycore

import android.content.Context

/**
 * Persisted, caller-configurable text for the foreground VPN notification.
 * Stored in SharedPreferences so [XrayVpnService] can read it even after a
 * service/process restart. Unset fields fall back to English defaults, so a
 * caller may translate only the strings it needs.
 */
object NotificationConfigStore {
    private const val PREFS = "nitro_xray_core"
    private const val KEY_TITLE = "notif_title"
    private const val KEY_TEXT = "notif_text"
    private const val KEY_DISCONNECT = "notif_disconnect"
    private const val KEY_BLOCKED = "notif_blocked"
    private const val KEY_CHANNEL = "notif_channel"

    // Defaults (English). Callers override any subset via setNotificationConfig.
    const val DEFAULT_TITLE = "VPN Active"
    const val DEFAULT_TEXT = "Protecting your connection"
    const val DEFAULT_DISCONNECT = "Disconnect"
    const val DEFAULT_BLOCKED = "Kill switch: traffic blocked"
    const val DEFAULT_CHANNEL = "VPN"

    fun set(
        context: Context,
        title: String?,
        text: String?,
        disconnectLabel: String?,
        blockedText: String?,
        channelName: String?,
    ) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().apply {
            putStringOrClear(KEY_TITLE, title)
            putStringOrClear(KEY_TEXT, text)
            putStringOrClear(KEY_DISCONNECT, disconnectLabel)
            putStringOrClear(KEY_BLOCKED, blockedText)
            putStringOrClear(KEY_CHANNEL, channelName)
            apply()
        }
    }

    private fun android.content.SharedPreferences.Editor.putStringOrClear(
        key: String,
        value: String?,
    ) {
        // Only overwrite when a non-empty value is provided; otherwise keep the
        // previously-set value (or the default) so partial updates are additive.
        if (!value.isNullOrEmpty()) putString(key, value)
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun title(context: Context): String =
        prefs(context).getString(KEY_TITLE, null) ?: DEFAULT_TITLE

    fun text(context: Context): String =
        prefs(context).getString(KEY_TEXT, null) ?: DEFAULT_TEXT

    fun disconnectLabel(context: Context): String =
        prefs(context).getString(KEY_DISCONNECT, null) ?: DEFAULT_DISCONNECT

    fun blockedText(context: Context): String =
        prefs(context).getString(KEY_BLOCKED, null) ?: DEFAULT_BLOCKED

    fun channelName(context: Context): String =
        prefs(context).getString(KEY_CHANNEL, null) ?: DEFAULT_CHANNEL
}
