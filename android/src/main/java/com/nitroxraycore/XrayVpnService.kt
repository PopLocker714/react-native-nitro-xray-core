package com.nitroxraycore

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.app.ServiceCompat

class XrayVpnService : VpnService() {
    private var vpnInterface: ParcelFileDescriptor? = null

    companion object {
        const val ACTION_START = "ACTION_START"
        const val ACTION_STOP = "ACTION_STOP"
        const val CHANNEL_ID = "xray_vpn_channel"
        private const val TAG = "XrayVpnService"
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ACTION_START

        if (action == ACTION_STOP) {
            Log.i(TAG, "Received STOP action")
            stopVpn()
            stopSelf()
            return START_NOT_STICKY
        }

        val configJson = intent?.getStringExtra("CONFIG_JSON")
        if (configJson == null) {
            Log.e(TAG, "No config JSON provided")
            stopSelf()
            return START_NOT_STICKY
        }

        startForegroundService()

        Thread {
            try {
                stopVpn() // Clean up any previous instance

                val tunFd = setupVpn()
                Log.i(TAG, "TUN interface established, fd=$tunFd")

                Log.i(TAG, "Starting XrayEngine...")
                val result = XrayEngine.start(configJson, tunFd)
                if (result != 0) {
                    Log.e(TAG, "XrayEngine failed to start with code: $result")
                    stopSelf()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start VPN", e)
                stopSelf()
            }
        }.start()

        return START_STICKY
    }

    private fun setupVpn(): Int {
        val builder = Builder()
        builder.setSession("Xray-core VPN")
        builder.setMtu(1500)
        builder.addAddress("10.0.0.2", 32)
        builder.addDnsServer("8.8.8.8")
        builder.addDnsServer("8.8.4.4")
        builder.addRoute("0.0.0.0", 0)       // Route all IPv4 traffic
        builder.addRoute("::", 0)             // Route all IPv6 traffic

        // Exclude our own app to prevent routing loop
        try {
            builder.addDisallowedApplication(packageName)
        } catch (e: Exception) {
            Log.w(TAG, "Could not disallow self: ${e.message}")
        }

        val pfd = builder.establish()
            ?: throw IllegalStateException("VpnService.Builder.establish() returned null. Was VPN permission granted?")

        vpnInterface = pfd
        return pfd.fd
    }

    private fun stopVpn() {
        XrayEngine.stop()
        try {
            vpnInterface?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing VPN interface", e)
        }
        vpnInterface = null
        Log.i(TAG, "VPN stopped")
    }

    private fun startForegroundService() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Xray VPN",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }

        val notification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("Xray VPN Active")
                .setContentText("Protecting your connection")
                .setSmallIcon(android.R.drawable.ic_lock_lock)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle("Xray VPN Active")
                .setContentText("Protecting your connection")
                .setSmallIcon(android.R.drawable.ic_lock_lock)
                .build()
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) { // Android 14
            ServiceCompat.startForeground(
                this,
                1,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(1, notification)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        stopVpn()
        Log.i(TAG, "XrayVpnService destroyed")
    }
}
