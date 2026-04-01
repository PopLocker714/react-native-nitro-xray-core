package com.margelo.nitro.nitroxraycore

import android.content.Intent
import android.net.VpnService
import com.nitroxraycore.XrayVpnService
import com.nitroxraycore.XrayEngine
import com.margelo.nitro.core.Promise
import com.margelo.nitro.NitroModules
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import android.util.Log

import kotlinx.coroutines.suspendCancellableCoroutine
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
                    com.nitroxraycore.VpnRequestActivity.pendingPromise = { result ->
                        continuation.resume(result)
                    }
                    val actIntent = Intent(context, com.nitroxraycore.VpnRequestActivity::class.java)
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
                    com.nitroxraycore.VpnRequestActivity.pendingPromise = { result ->
                        continuation.resume(result)
                    }
                    val actIntent = Intent(context, com.nitroxraycore.VpnRequestActivity::class.java)
                    actIntent.action = com.nitroxraycore.VpnRequestActivity.ACTION_REQUEST_NOTIFICATION
                    actIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(actIntent)
                }
                return@async granted
            }
            return@async true
        }
    }



    override fun startXray(configJson: String): Promise<Unit> {
        return Promise.async {
            val context = NitroModules.applicationContext
            if (context == null) throw Exception("Application context is null")
            
            Log.i("NitroXrayCore", "Starting XrayVpnService...")
            val intent = Intent(context, XrayVpnService::class.java).apply {
                putExtra("CONFIG_JSON", configJson)
            }
            context.startService(intent)
        }
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
}
