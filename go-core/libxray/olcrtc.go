//go:build android
// +build android

package main

import "C"

import (
	"encoding/json"
	"fmt"

	"github.com/openlibrecommunity/olcrtc/mobile"
)

// olcrtcConfig is the JSON payload StartOlcrtc accepts. It maps directly onto
// olcrtc's mobile.Start arguments plus a few optional setters. The JS layer
// builds this from an olcrtc client URI / subscription entry.
type olcrtcConfig struct {
	// Carrier name: "telemost", "wbstream", "jitsi", ...
	Carrier string `json:"carrier"`
	// Carrier-specific room ID.
	RoomID string `json:"roomId"`
	// Client identifier; must match the server's -client-id.
	ClientID string `json:"clientId"`
	// 64-char hex encryption key.
	KeyHex string `json:"keyHex"`
	// Local SOCKS5 port to listen on. Default 10808.
	SocksPort int `json:"socksPort"`
	// Optional SOCKS5 auth (empty = no auth).
	SocksUser string `json:"socksUser"`
	SocksPass string `json:"socksPass"`
	// Optional bind host for the SOCKS listener. Default 127.0.0.1.
	SocksHost string `json:"socksHost"`
	// Optional DNS server for the tunnel (e.g. "8.8.8.8:53").
	DNSServer string `json:"dnsServer"`
	// Optional transport override: "vp8channel" (default) or "datachannel".
	Transport string `json:"transport"`
	// How long to wait for the SOCKS listener to become ready. Default 15000ms.
	ReadyTimeoutMs int `json:"readyTimeoutMs"`
	// vp8channel throughput tuning. Bigger batch = higher speed (capped at 64
	// by the engine); lower fps = less CPU. 0 keeps the engine default.
	Vp8Fps       int `json:"vp8Fps"`
	Vp8BatchSize int `json:"vp8BatchSize"`
	// Emit olcrtc's verbose internal logs (pion/ICE/KCP) to Android logcat under
	// tag "XrayGo" — use to diagnose relay vs direct paths and packet loss.
	Debug bool `json:"debug"`
}

// olcrtcLogWriter pipes olcrtc's internal logs into Android logcat (via the
// same C logger main.go uses), so pion/ICE/KCP diagnostics are visible.
type olcrtcLogWriter struct{}

func (olcrtcLogWriter) WriteLog(msg string) { logInfo("olcrtc: " + msg) }

const defaultOlcrtcSocksPort = 10808

// olcrtcSocksPort holds the port the running olcrtc SOCKS5 listener is bound
// to, so GetOlcrtcSocksPort can report it back to the JS layer for building the
// xray dialerProxy config. Zero when olcrtc is not running.
var olcrtcSocksPort int

// StartOlcrtc launches the olcRTC WebRTC-side-channel client and blocks until
// its local SOCKS5 listener is ready (or the ready timeout elapses). On success
// the SOCKS port is recorded for GetOlcrtcSocksPort.
//
// Return codes: 0 ok, -1 config parse error, -2 start error, -3 not ready.
//
// NOTE: this runs a SOCKS-only olcrtc instance (no TUN). The xray instance owns
// the TUN; xray dials its server outbound through this SOCKS listener via
// streamSettings.sockopt.dialerProxy.
//
//export StartOlcrtc
func StartOlcrtc(configStr *C.char) C.int {
	var cfg olcrtcConfig
	if err := json.Unmarshal([]byte(C.GoString(configStr)), &cfg); err != nil {
		logError(fmt.Sprintf("olcrtc: failed to parse config: %v", err))
		return -1
	}

	if cfg.SocksPort <= 0 {
		cfg.SocksPort = defaultOlcrtcSocksPort
	}
	if cfg.ReadyTimeoutMs <= 0 {
		cfg.ReadyTimeoutMs = 15000
	}

	// A previous instance may still be alive (stale session after a reload or a
	// double toggle); mobile.Start would return "already running". Stop it so a
	// fresh start always succeeds.
	if mobile.IsRunning() {
		logInfo("olcrtc: stopping stale instance before restart")
		mobile.Stop()
	}

	// Route olcrtc's internal logs to logcat, and go verbose when requested.
	mobile.SetLogWriter(olcrtcLogWriter{})
	mobile.SetDebug(cfg.Debug)

	// Register built-in carriers/links/transports before starting.
	mobile.SetProviders()

	if cfg.SocksHost != "" {
		mobile.SetSocksListenHost(cfg.SocksHost)
	}
	if cfg.DNSServer != "" {
		mobile.SetDNS(cfg.DNSServer)
	}
	// vp8channel throughput tuning (no-op for other transports).
	if cfg.Vp8Fps > 0 || cfg.Vp8BatchSize > 0 {
		mobile.SetVP8Options(cfg.Vp8Fps, cfg.Vp8BatchSize)
	}

	var err error
	if cfg.Transport != "" {
		err = mobile.StartWithTransport(
			cfg.Carrier, cfg.Transport, cfg.RoomID, cfg.ClientID, cfg.KeyHex,
			cfg.SocksPort, cfg.SocksUser, cfg.SocksPass,
		)
	} else {
		err = mobile.Start(
			cfg.Carrier, cfg.RoomID, cfg.ClientID, cfg.KeyHex,
			cfg.SocksPort, cfg.SocksUser, cfg.SocksPass,
		)
	}
	if err != nil {
		logError(fmt.Sprintf("olcrtc: start failed: %v", err))
		return -2
	}

	if err := mobile.WaitReady(cfg.ReadyTimeoutMs); err != nil {
		logError(fmt.Sprintf("olcrtc: not ready: %v", err))
		mobile.Stop()
		return -3
	}

	olcrtcSocksPort = cfg.SocksPort
	logInfo(fmt.Sprintf("olcrtc: SOCKS5 ready on port %d", cfg.SocksPort))
	return 0
}

// StopOlcrtc gracefully stops the olcRTC client. Idempotent.
//
//export StopOlcrtc
func StopOlcrtc() C.int {
	mobile.Stop()
	olcrtcSocksPort = 0
	logInfo("olcrtc: stopped")
	return 0
}

// GetOlcrtcSocksPort returns the local SOCKS5 port the running olcrtc client
// listens on, or 0 if it is not running. The JS layer feeds this into
// buildXrayConfig({ olcrtc: { socksPort } }).
//
//export GetOlcrtcSocksPort
func GetOlcrtcSocksPort() C.int {
	if !mobile.IsRunning() {
		return 0
	}
	return C.int(olcrtcSocksPort)
}

// IsOlcrtcRunning reports whether the olcrtc client is active (1) or not (0).
//
//export IsOlcrtcRunning
func IsOlcrtcRunning() C.int {
	if mobile.IsRunning() {
		return 1
	}
	return 0
}
