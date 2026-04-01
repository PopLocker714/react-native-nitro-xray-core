package com.nitroxraycore

import android.util.Log

object XrayEngine {
    private val TAG = "XrayEngine"

    init {
        try {
            System.loadLibrary("xray")
            Log.i(TAG, "libxray.so loaded successfully")
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to load libxray.so", e)
        }
        try {
            System.loadLibrary("NitroXrayCore")
            Log.i(TAG, "NitroXrayCore loaded successfully")
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to load NitroXrayCore", e)
        }
    }

    // configJson: Xray JSON config, tunFd: file descriptor from VpnService
    external fun start(configJson: String, tunFd: Int): Int
    external fun stop(): Int
}
