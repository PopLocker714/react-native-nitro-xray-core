//go:build ios
// +build ios

package main

/*
#include <mach/mach.h>
#include <stdlib.h>

// Resident set size (bytes) of the current process — for the NE memory-budget
// experiment. Returns 0 on failure.
static unsigned long long current_rss_bytes() {
    mach_task_basic_info_data_t info;
    mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
    kern_return_t kr = task_info(mach_task_self(), MACH_TASK_BASIC_INFO,
                                 (task_info_t)&info, &count);
    if (kr != KERN_SUCCESS) return 0;
    return (unsigned long long)info.resident_size;
}
*/
import "C"

import (
	"encoding/json"
	"fmt"

	"github.com/openlibrecommunity/olcrtc/mobile"
)

// iosOlcrtcConfig mirrors the Android olcrtcConfig (SOCKS-only olcrtc client).
type iosOlcrtcConfig struct {
	Carrier        string `json:"carrier"`
	RoomID         string `json:"roomId"`
	ClientID       string `json:"clientId"`
	KeyHex         string `json:"keyHex"`
	SocksPort      int    `json:"socksPort"`
	SocksUser      string `json:"socksUser"`
	SocksPass      string `json:"socksPass"`
	SocksHost      string `json:"socksHost"`
	DNSServer      string `json:"dnsServer"`
	Transport      string `json:"transport"`
	ReadyTimeoutMs int    `json:"readyTimeoutMs"`
	Vp8Fps         int    `json:"vp8Fps"`
	Vp8BatchSize   int    `json:"vp8BatchSize"`
	Debug          bool   `json:"debug"`
	// Retries for the flaky carrier TURN/ICE handshake. Default 3.
	Retries int `json:"retries"`
}

const iosDefaultOlcrtcSocksPort = 10808

var iosOlcrtcSocksPort int

// StartOlcrtc launches the olcRTC SOCKS-only client on iOS (no TUN; xray owns
// the TUN in the NE). Blocks until the SOCKS listener is ready or the timeout
// elapses. 0 ok, -1 config parse, -2 start error, -3 not ready.
//
//export StartOlcrtc
func StartOlcrtc(configStr *C.char) C.int {
	var cfg iosOlcrtcConfig
	if err := json.Unmarshal([]byte(C.GoString(configStr)), &cfg); err != nil {
		logError(fmt.Sprintf("olcrtc: parse config: %v", err))
		return -1
	}
	if cfg.SocksPort <= 0 {
		cfg.SocksPort = iosDefaultOlcrtcSocksPort
	}
	if cfg.ReadyTimeoutMs <= 0 {
		cfg.ReadyTimeoutMs = 15000
	}

	if mobile.IsRunning() {
		mobile.Stop()
	}
	mobile.SetDebug(cfg.Debug)
	mobile.SetProviders()
	if cfg.SocksHost != "" {
		mobile.SetSocksListenHost(cfg.SocksHost)
	}
	if cfg.DNSServer != "" {
		mobile.SetDNS(cfg.DNSServer)
	}
	if cfg.Vp8Fps > 0 || cfg.Vp8BatchSize > 0 {
		mobile.SetVP8Options(cfg.Vp8Fps, cfg.Vp8BatchSize)
	}

	retries := cfg.Retries
	if retries <= 0 {
		retries = 3
	}

	var rc C.int = -3
	for attempt := 1; attempt <= retries; attempt++ {
		if mobile.IsRunning() {
			mobile.Stop()
		}
		var err error
		if cfg.Transport != "" {
			err = mobile.StartWithTransport(cfg.Carrier, cfg.Transport, cfg.RoomID,
				cfg.ClientID, cfg.KeyHex, cfg.SocksPort, cfg.SocksUser, cfg.SocksPass)
		} else {
			err = mobile.Start(cfg.Carrier, cfg.RoomID, cfg.ClientID, cfg.KeyHex,
				cfg.SocksPort, cfg.SocksUser, cfg.SocksPass)
		}
		if err != nil {
			logError(fmt.Sprintf("olcrtc: start (attempt %d/%d): %v", attempt, retries, err))
			rc = -2
			continue
		}
		if err := mobile.WaitReady(cfg.ReadyTimeoutMs); err != nil {
			logError(fmt.Sprintf("olcrtc: not ready (attempt %d/%d): %v", attempt, retries, err))
			mobile.Stop()
			rc = -3
			continue
		}
		iosOlcrtcSocksPort = cfg.SocksPort
		logInfo(fmt.Sprintf("olcrtc: SOCKS5 ready on %d", cfg.SocksPort))
		return 0
	}
	return rc
}

//export StopOlcrtc
func StopOlcrtc() C.int {
	mobile.Stop()
	iosOlcrtcSocksPort = 0
	return 0
}

//export GetOlcrtcSocksPort
func GetOlcrtcSocksPort() C.int {
	if !mobile.IsRunning() {
		return 0
	}
	return C.int(iosOlcrtcSocksPort)
}

//export IsOlcrtcRunning
func IsOlcrtcRunning() C.int {
	if mobile.IsRunning() {
		return 1
	}
	return 0
}

// CurrentRSSBytes returns the process resident set size in bytes — used to
// verify the merged xray+olcrtc runtime fits the NE memory budget (~50 MB on
// iOS 15+).
//
//export CurrentRSSBytes
func CurrentRSSBytes() C.ulonglong {
	return C.current_rss_bytes()
}
