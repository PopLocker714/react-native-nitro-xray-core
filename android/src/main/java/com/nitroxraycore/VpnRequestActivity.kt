package com.nitroxraycore

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

class VpnRequestActivity : Activity() {

    companion object {
        // Callbacks keyed by a per-request id. A single shared slot would let two
        // concurrent requests (e.g. VPN + notification permission) clobber each
        // other, leaving one promise to hang forever.
        private val pending = ConcurrentHashMap<Int, (Boolean) -> Unit>()
        private val idGen = AtomicInteger(0)
        const val EXTRA_REQUEST_ID = "request_id"
        val ACTION_REQUEST_NOTIFICATION = "REQUEST_NOTIFICATION"

        /** Register a result callback; put the returned id in the launch intent. */
        fun register(callback: (Boolean) -> Unit): Int {
            val id = idGen.incrementAndGet()
            pending[id] = callback
            return id
        }

        private fun resolve(id: Int, granted: Boolean) {
            pending.remove(id)?.invoke(granted)
        }
    }

    private var requestId: Int = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestId = intent?.getIntExtra(EXTRA_REQUEST_ID, 0) ?: 0

        if (intent?.action == ACTION_REQUEST_NOTIFICATION) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 2)
            } else {
                resolve(requestId, true)
                finish()
            }
            return
        }

        val vpnIntent = VpnService.prepare(this)
        if (vpnIntent != null) {
            startActivityForResult(vpnIntent, 1)
        } else {
            resolve(requestId, true)
            finish()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 2) {
            val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            resolve(requestId, granted)
        }
        finish()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 1) {
            resolve(requestId, resultCode == RESULT_OK)
        }
        finish()
    }
}
