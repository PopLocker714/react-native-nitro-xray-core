//go:build ios
// +build ios

package main

/*
#include <stdlib.h>
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

	// Import all features just like Android so routing and inbounds work
	_ "github.com/xtls/xray-core/main/distro/all"
)

var runningServer core.Server

func init() {
	// iOS 15+ raised the packet-tunnel NE memory limit to ~50MB (was 15MB on
	// iOS 14). Target 45MB — leaves Jetsam headroom while giving the merged
	// xray+olcrtc runtime room. Go treats this as a soft GC target.
	debug.SetMemoryLimit(45 * 1024 * 1024)

	// Aggressive GC
	os.Setenv("GOGC", "10")
	
	// Return memory to iOS immediately
	os.Setenv("GODEBUG", "madvdontneed=1")
}

func logInfo(msg string) {
	fmt.Fprintf(os.Stderr, "[XrayGo] INFO: %s\n", msg)
}

func logError(msg string) {
	fmt.Fprintf(os.Stderr, "[XrayGo] ERROR: %s\n", msg)
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

// GetVersion returns the Xray-core version string
//export GetVersion
func GetVersion() *C.char {
	return C.CString(core.Version())
}

// FreeString frees a C string allocated by Go (call from Swift after using a returned *C.char)
//export FreeString
func FreeString(s *C.char) {
	C.free(unsafe.Pointer(s))
}

// QueryStats returns cumulative uplink/downlink byte counters for the given
// outbound tag as JSON: {"uplink":<int64>,"downlink":<int64>}. Zeros if the
// server is not running or stats are not enabled. Free the result with
// FreeString. Mirrors the Android export so getStats() works over the NE.
//export QueryStats
func QueryStats(outboundTag *C.char) *C.char {
	up, down := queryOutboundTraffic(C.GoString(outboundTag))
	return C.CString(fmt.Sprintf(`{"uplink":%d,"downlink":%d}`, up, down))
}

func queryOutboundTraffic(tag string) (int64, int64) {
	if runningServer == nil || tag == "" {
		return 0, 0
	}
	inst, ok := runningServer.(*core.Instance)
	if !ok {
		return 0, 0
	}
	feature := inst.GetFeature(stats.ManagerType())
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

func main() {}
