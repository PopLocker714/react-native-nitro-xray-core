package com.nitroxraycore

import android.content.Context

/**
 * The last successful start payload, kept so an entry point OUTSIDE the JS
 * runtime can bring the tunnel back up — a home-screen widget, a Quick Settings
 * tile, a shortcut. Those run in a cold process where React Native is not
 * loaded, so they cannot build a config; the only way to connect from one is to
 * replay the last config that worked.
 *
 * OPT-IN, and deliberately so. An Xray config carries the server credential
 * (the VLESS/VMess id), so storing it puts a secret at rest in the app's
 * private storage. That is the same posture as any VPN client that offers a
 * one-tap toggle, but it is the consumer's decision to make, not the library's:
 * an app with no widget should never pay that cost. Nothing is written until
 * [setEnabled] is called with `true`, and disabling wipes what was stored.
 *
 * MODE_PRIVATE, not encrypted. The threat this does NOT defend against is an
 * attacker who can already read the app's private data directory — at that
 * point they have the Keychain-backed subscription cache too. Documented rather
 * than papered over with a dependency that would not change the outcome.
 */
object QuickConnectStore {
    private const val PREFS = "nitro_xray_core"
    private const val KEY_ENABLED = "quick_connect_enabled"
    private const val KEY_CONFIG = "quick_connect_config"
    private const val KEY_DNS = "quick_connect_dns"
    private const val KEY_OLCRTC = "quick_connect_olcrtc"
    private const val KEY_CONN_INFO = "quick_connect_conn_info"

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isEnabled(context: Context): Boolean =
        prefs(context).getBoolean(KEY_ENABLED, false)

    /** Turn the feature on or off. Turning it off also wipes the stored payload. */
    fun setEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().apply {
            putBoolean(KEY_ENABLED, enabled)
            if (!enabled) {
                remove(KEY_CONFIG)
                remove(KEY_DNS)
                remove(KEY_OLCRTC)
                remove(KEY_CONN_INFO)
            }
            apply()
        }
    }

    /**
     * Record a payload that actually started the engine. Called only on success,
     * so a widget can never replay a config that was already known to fail.
     */
    fun save(
        context: Context,
        configJson: String,
        dnsServers: List<String>,
        olcrtcJson: String? = null,
    ) {
        if (!isEnabled(context)) return
        prefs(context).edit()
            .putString(KEY_CONFIG, configJson)
            .putString(KEY_DNS, dnsServers.joinToString(","))
            .apply {
                // Конфиг обхода хранится РЯДОМ с конфигом xray, а не вместо него.
                // Конфиг xray в режиме обхода ссылается на 127.0.0.1:<socks>, и
                // этот порт существует, только пока работает olcrtc. Без второй
                // половины воспроизведение подняло бы туннель в мёртвый прокси:
                // подключено, тихо, без единой ошибки.
                if (olcrtcJson != null) putString(KEY_OLCRTC, olcrtcJson)
                else remove(KEY_OLCRTC)
                // Снимок описания подключения на момент успеха: при отключении
                // клиент его стирает, а воспроизвести старт без JS некому.
                val info = prefs(context).getString("connection_info", null)
                if (info != null) putString(KEY_CONN_INFO, info) else remove(KEY_CONN_INFO)
            }
            .apply()
    }

    /** The stored config, or null when the feature is off or nothing succeeded yet. */
    fun config(context: Context): String? {
        if (!isEnabled(context)) return null
        return prefs(context).getString(KEY_CONFIG, null)
    }

    /** DNS servers the stored config was started with; empty means "use the default". */
    fun dnsServers(context: Context): List<String> {
        val raw = prefs(context).getString(KEY_DNS, null) ?: return emptyList()
        return raw.split(",").map { it.trim() }.filter { it.isNotEmpty() }
    }

    /**
     * Клиентский конфиг обхода последнего успешного старта, или null, если тот
     * старт шёл напрямую. Быстрое подключение обязано поднять обход ПЕРЕД
     * движком, иначе движку некуда будет дозваниваться.
     */
    /**
     * Описание подключения (`connection_info`), снятое на момент успешного
     * старта.
     *
     * Нужно, потому что клиент СТИРАЕТ `connection_info` при отключении, а
     * быстрый старт идёт без JS и записать его заново некому. Без этого
     * уведомление после старта с виджета оставалось безымянным: «Подключено ·»
     * и ничего дальше.
     */
    fun connectionInfo(context: Context): String? {
        if (!isEnabled(context)) return null
        return prefs(context).getString(KEY_CONN_INFO, null)
    }

    /** Восстановить описание подключения перед стартом без JS. */
    fun restoreConnectionInfo(context: Context) {
        val saved = connectionInfo(context) ?: return
        prefs(context).edit().putString("connection_info", saved).apply()
    }

    fun olcrtcConfig(context: Context): String? {
        if (!isEnabled(context)) return null
        return prefs(context).getString(KEY_OLCRTC, null)
    }

    /** Whether a one-tap reconnect is possible right now. */
    fun isReady(context: Context): Boolean = config(context) != null

    fun clear(context: Context) {
        prefs(context).edit().remove(KEY_CONFIG).remove(KEY_DNS).remove(KEY_OLCRTC).remove(KEY_CONN_INFO).apply()
    }
}
