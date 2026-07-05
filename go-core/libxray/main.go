//go:build android
// +build android

package main

/*
#cgo LDFLAGS: -llog
#include <android/log.h>
#include <stdlib.h>
#define TAG "XrayGo"
static void log_info(const char* msg) {
    __android_log_print(ANDROID_LOG_INFO, TAG, "%s", msg);
}
static void log_error(const char* msg) {
    __android_log_print(ANDROID_LOG_ERROR, TAG, "%s", msg);
}
*/
import "C"

import (
	"bytes"
	"fmt"
	"os"
	"runtime"
	"runtime/debug"
	"strconv"
	"unsafe"

	"github.com/xtls/xray-core/core"
	"github.com/xtls/xray-core/features/stats"

	_ "github.com/xtls/xray-core/main/distro/all"
)

var runningServer *core.Instance

func logInfo(msg string) {
	cmsg := C.CString(msg)
	defer C.free(unsafe.Pointer(cmsg))
	C.log_info(cmsg)
}

func logError(msg string) {
	cmsg := C.CString(msg)
	defer C.free(unsafe.Pointer(cmsg))
	C.log_error(cmsg)
}

//export StartXray
func StartXray(configStr *C.char, tunFd C.int) C.int {
	if runningServer != nil {
		logError("Xray: Server is already running")
		return -1
	}

	goConfig := C.GoString(configStr)
	tunFdInt := int(tunFd)

	if tunFdInt > 0 {
		logInfo(fmt.Sprintf("Xray: Using TUN fd=%d", tunFdInt))
		os.Setenv("xray.tun.fd", strconv.Itoa(tunFdInt))
	} else {
		logInfo("Xray: No TUN fd provided, running in proxy mode")
	}

	configObj, err := core.LoadConfig("json", bytes.NewReader([]byte(goConfig)))
	if err != nil {
		logError(fmt.Sprintf("Xray: Failed to parse config: %v", err))
		return -2
	}

	server, err := core.New(configObj)
	if err != nil {
		logError(fmt.Sprintf("Xray: Failed to init server: %v", err))
		return -3
	}

	if err := server.Start(); err != nil {
		logError(fmt.Sprintf("Xray: Failed to start server: %v", err))
		return -4
	}

	runningServer = server

	// Initial GC
	runtime.GC()
	debug.FreeOSMemory()

	logInfo("Xray: Server started successfully")
	return 0
}

//export StopXray
func StopXray() C.int {
	if runningServer != nil {
		err := runningServer.Close()
		runningServer = nil
		if err != nil {
			logError(fmt.Sprintf("Xray: Failed to stop server: %v", err))
			return -1
		}
		logInfo("Xray: Server stopped")
	}
	return 0
}

// GetVersion returns the Xray-core version string.
//
//export GetVersion
func GetVersion() *C.char {
	return C.CString(core.Version())
}

// QueryStats returns cumulative uplink/downlink byte counters for the given
// outbound tag as a JSON string: {"uplink":<int64>,"downlink":<int64>}.
// Returns zeros if the server is not running or stats are not enabled in the
// config. The caller must free the returned string with FreeString.
//
//export QueryStats
func QueryStats(outboundTag *C.char) *C.char {
	up, down := queryOutboundTraffic(C.GoString(outboundTag))
	return C.CString(fmt.Sprintf(`{"uplink":%d,"downlink":%d}`, up, down))
}

func queryOutboundTraffic(tag string) (int64, int64) {
	if runningServer == nil || tag == "" {
		return 0, 0
	}

	feature := runningServer.GetFeature(stats.ManagerType())
	if feature == nil {
		return 0, 0
	}
	manager, ok := feature.(stats.Manager)
	if !ok {
		return 0, 0
	}

	return counterValue(manager, "outbound>>>"+tag+">>>traffic>>>uplink"),
		counterValue(manager, "outbound>>>"+tag+">>>traffic>>>downlink")
}

func counterValue(m stats.Manager, name string) int64 {
	c := m.GetCounter(name)
	if c == nil {
		return 0
	}
	return c.Value()
}

// FreeString frees a C string allocated by Go. Call from native code after
// consuming a *C.char returned by GetVersion or QueryStats.
//
//export FreeString
func FreeString(s *C.char) {
	C.free(unsafe.Pointer(s))
}

func main() {}
