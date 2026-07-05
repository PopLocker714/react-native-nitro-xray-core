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

    // Xray-core version string.
    external fun getVersion(): String

    // Returns a JSON string {"uplink":N,"downlink":N} for the given outbound tag.
    external fun queryStats(outboundTag: String): String

    // --- olcrtc (WebRTC side-channel, SOCKS-only) ---
    // configJson: olcrtc client params. Blocks until the SOCKS listener is
    // ready or the ready timeout elapses. Returns 0 on success, negative on
    // error (-1 config parse, -2 start failed, -3 not ready).
    external fun startOlcrtc(configJson: String): Int
    external fun stopOlcrtc(): Int
    // Local SOCKS5 port olcrtc listens on, or 0 if not running.
    external fun getOlcrtcSocksPort(): Int
    // 1 if the olcrtc client is running, else 0.
    external fun isOlcrtcRunning(): Int
}
