package com.nitroxraycore

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import android.os.Bundle

class VpnRequestActivity : Activity() {

    companion object {
        var pendingPromise: ((Boolean) -> Unit)? = null
        val ACTION_REQUEST_NOTIFICATION = "REQUEST_NOTIFICATION"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        if (intent?.action == ACTION_REQUEST_NOTIFICATION) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 2)
            } else {
                pendingPromise?.invoke(true)
                pendingPromise = null
                finish()
            }
            return
        }

        val vpnIntent = VpnService.prepare(this)
        if (vpnIntent != null) {
            startActivityForResult(vpnIntent, 1)
        } else {
            pendingPromise?.invoke(true)
            pendingPromise = null
            finish()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 2) {
            val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            pendingPromise?.invoke(granted)
            pendingPromise = null
        }
        finish()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 1) {
            val granted = resultCode == RESULT_OK
            pendingPromise?.invoke(granted)
            pendingPromise = null
        }
        finish()
    }
}
