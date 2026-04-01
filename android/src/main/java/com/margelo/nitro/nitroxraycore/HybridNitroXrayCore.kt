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

@Keep
@DoNotStrip
class HybridNitroXrayCore: HybridNitroXrayCoreSpec() {
    override fun prepareVpn(): Promise<Unit> {
        return Promise.async {
            val context = NitroModules.applicationContext
            if (context == null) throw Exception("Application context is null")
            
            val intent = VpnService.prepare(context)
            if (intent != null) {
                val actIntent = Intent(context, com.nitroxraycore.VpnRequestActivity::class.java)
                actIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(actIntent)
                // Return an error for now. The JS side will catch it and understand it was requested.
                throw Exception("VPN Permission Requested. Please accept the dialog then Retry.")
            } else {
                Log.i("NitroXrayCore", "VPN permission already granted")
            }
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
