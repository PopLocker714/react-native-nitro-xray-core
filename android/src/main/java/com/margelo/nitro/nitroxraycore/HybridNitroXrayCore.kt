package com.margelo.nitro.nitroxraycore

import android.content.Intent
import android.net.VpnService
import com.nitroxraycore.XrayVpnService
import com.nitroxraycore.XrayEngine
import com.nitroxraycore.XrayStateBus
import com.margelo.nitro.core.Promise
import com.margelo.nitro.NitroModules
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import android.util.Log
import org.json.JSONObject

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

@Keep
@DoNotStrip
class HybridNitroXrayCore: HybridNitroXrayCoreSpec() {
    override fun isVpnConnected(): Boolean {
        return com.nitroxraycore.XrayVpnService.isRunning
    }

    override fun hasVpnPermission(): Promise<Boolean> {
        return Promise.async {
            val context = NitroModules.applicationContext
            if (context == null) throw Exception("Application context is null")

            val intent = VpnService.prepare(context)
            return@async intent == null
        }
    }

    override fun requestVpnPermission(): Promise<Unit> {
        return Promise.async {
            val context = NitroModules.applicationContext
            if (context == null) throw Exception("Application context is null")

            val intent = VpnService.prepare(context)
            if (intent != null) {
                val granted = suspendCancellableCoroutine<Boolean> { continuation ->
                    val id = com.nitroxraycore.VpnRequestActivity.register { result ->
                        continuation.resume(result)
                    }
                    val actIntent = Intent(context, com.nitroxraycore.VpnRequestActivity::class.java)
                    actIntent.putExtra(com.nitroxraycore.VpnRequestActivity.EXTRA_REQUEST_ID, id)
                    actIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(actIntent)
                }

                if (!granted) {
                    throw Exception("VPN Permission Denied by User")
                }
            } else {
                Log.i("NitroXrayCore", "VPN permission already granted")
            }
        }
    }

    override fun requestNotificationPermission(): Promise<Boolean> {
        return Promise.async {
            val context = NitroModules.applicationContext
            if (context == null) throw Exception("Application context is null")

            if (android.os.Build.VERSION.SDK_INT >= 33) {
                if (context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    return@async true
                }

                val granted = suspendCancellableCoroutine<Boolean> { continuation ->
                    val id = com.nitroxraycore.VpnRequestActivity.register { result ->
                        continuation.resume(result)
                    }
                    val actIntent = Intent(context, com.nitroxraycore.VpnRequestActivity::class.java)
                    actIntent.action = com.nitroxraycore.VpnRequestActivity.ACTION_REQUEST_NOTIFICATION
                    actIntent.putExtra(com.nitroxraycore.VpnRequestActivity.EXTRA_REQUEST_ID, id)
                    actIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(actIntent)
                }
                return@async granted
            }
            return@async true
        }
    }



    override fun getVersion(): String {
        return try {
            XrayEngine.getVersion()
        } catch (e: Throwable) {
            Log.e("NitroXrayCore", "getVersion failed", e)
            ""
        }
    }

    override fun getStats(outboundTag: String): Promise<TrafficStats> {
        return Promise.async {
            // Not running = genuinely no traffic. Distinguish that from a broken
            // stats pipeline while connected, which rejects (M6) so callers don't
            // mistake a failure for a real 0-bytes idle.
            if (!com.nitroxraycore.XrayVpnService.isRunning) {
                return@async TrafficStats(0.0, 0.0)
            }
            try {
                val json = XrayEngine.queryStats(outboundTag)
                val obj = JSONObject(json)
                TrafficStats(
                    obj.optLong("uplink", 0L).toDouble(),
                    obj.optLong("downlink", 0L).toDouble()
                )
            } catch (e: Throwable) {
                Log.e("NitroXrayCore", "getStats failed", e)
                throw Exception("STATS_UNAVAILABLE|${e.message ?: "stats query failed"}")
            }
        }
    }

    override fun onStateChange(callback: (state: String, message: String) -> Unit) {
        XrayStateBus.listener = callback
    }

    override fun startXray(configJson: String): Promise<Unit> {
        return Promise.async {
            val context = NitroModules.applicationContext
                ?: throw Exception("Application context is null")

            Log.i("NitroXrayCore", "Starting XrayVpnService...")

            // Suspend until the service reports the real engine start result,
            // so the JS Promise reflects actual success/failure rather than
            // merely "service dispatched".
            suspendCancellableCoroutine<Unit> { continuation ->
                XrayStateBus.setPendingStart { success, error ->
                    if (success) {
                        continuation.resume(Unit)
                    } else {
                        continuation.resumeWith(
                            Result.failure(Exception(error ?: "Xray failed to start"))
                        )
                    }
                }

                val intent = Intent(context, XrayVpnService::class.java).apply {
                    putExtra("CONFIG_JSON", configJson)
                }
                try {
                    context.startService(intent)
                } catch (e: Throwable) {
                    XrayStateBus.resolveStart(false, e.message ?: "startService failed")
                }
            }
        }
    }

    override fun setKillSwitch(enabled: Boolean): Promise<Unit> {
        return Promise.async {
            val context = NitroModules.applicationContext
                ?: throw Exception("Application context is null")
            com.nitroxraycore.KillSwitchStore.set(context, enabled)
            Log.i("NitroXrayCore", "Kill switch ${if (enabled) "enabled" else "disabled"}")
        }
    }

    override fun isKillSwitchEnabled(): Boolean {
        val context = NitroModules.applicationContext ?: return false
        return com.nitroxraycore.KillSwitchStore.get(context)
    }

    override fun stopXray(): Promise<Unit> {
        return Promise.async {
            val context = NitroModules.applicationContext
            if (context == null) throw Exception("Application context is null")

            Log.i("NitroXrayCore", "Sending STOP to XrayVpnService...")
            val intent = Intent(context, com.nitroxraycore.XrayVpnService::class.java).apply {
                action = "ACTION_STOP"
            }
            context.startService(intent)
        }
    }

    // --- olcrtc (WebRTC side-channel, SOCKS-only) ---
    // olcrtc runs in-process and needs no VpnService: the running VPN already
    // excludes this whole app from the tun via addDisallowedApplication, so
    // olcrtc's own sockets bypass the tunnel without a per-socket protect.

    override fun startOlcrtc(configJson: String): Promise<Unit> {
        return Promise.async {
            // StartOlcrtc blocks until the SOCKS listener is ready (WaitReady),
            // so run it off the calling thread.
            val result = withContext(Dispatchers.IO) {
                XrayEngine.startOlcrtc(configJson)
            }
            if (result != 0) {
                // "CODE|message" — the JS client parses the prefix into a typed
                // XrayError so callers can branch (retry vs. fatal).
                val reason = when (result) {
                    -1 -> "OLCRTC_INVALID_CONFIG|invalid olcrtc config JSON"
                    -2 -> "OLCRTC_START_FAILED|olcrtc failed to start"
                    -3 -> "OLCRTC_NOT_READY|olcrtc SOCKS listener not ready in time"
                    else -> "OLCRTC_START_FAILED|olcrtc start failed (code $result)"
                }
                throw Exception(reason)
            }
            Log.i("NitroXrayCore", "olcrtc started, SOCKS port ${XrayEngine.getOlcrtcSocksPort()}")
        }
    }

    override fun stopOlcrtc(): Promise<Unit> {
        return Promise.async {
            withContext(Dispatchers.IO) { XrayEngine.stopOlcrtc() }
            Log.i("NitroXrayCore", "olcrtc stopped")
        }
    }

    override fun getOlcrtcSocksPort(): Double {
        return try {
            XrayEngine.getOlcrtcSocksPort().toDouble()
        } catch (e: Throwable) {
            Log.e("NitroXrayCore", "getOlcrtcSocksPort failed", e)
            0.0
        }
    }

    override fun isOlcrtcRunning(): Boolean {
        return try {
            XrayEngine.isOlcrtcRunning() != 0
        } catch (e: Throwable) {
            Log.e("NitroXrayCore", "isOlcrtcRunning failed", e)
            false
        }
    }

    override fun setNotificationConfig(config: NotificationConfig) {
        val context = NitroModules.applicationContext ?: return
        com.nitroxraycore.NotificationConfigStore.set(
            context,
            config.title,
            config.text,
            config.disconnectLabel,
            config.blockedText,
            config.channelName,
        )
    }

    // iOS-only concept (the VPN name in iOS Settings). On Android the system
    // shows the app label, so there's nothing to set — no-op.
    override fun setVpnName(name: String) {
        // no-op on Android
    }

    override fun setConnectionInfo(json: String) {
        val context = NitroModules.applicationContext ?: return
        val prefs = context.getSharedPreferences("nitro_xray_core", android.content.Context.MODE_PRIVATE)
        prefs.edit().apply {
            if (json.isEmpty()) remove("connection_info") else putString("connection_info", json)
        }.apply()
    }

    override fun getConnectionInfo(): String {
        val context = NitroModules.applicationContext ?: return ""
        val prefs = context.getSharedPreferences("nitro_xray_core", android.content.Context.MODE_PRIVATE)
        return prefs.getString("connection_info", "") ?: ""
    }
}
