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
	// Import all features just like Android so routing and inbounds work
	_ "github.com/xtls/xray-core/main/distro/all"
)

var runningServer core.Server

func init() {
	// Strictly limiting to 14MB to avoid iOS Jetsam kills for Network Extensions
	debug.SetMemoryLimit(14 * 1024 * 1024)
	
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

func main() {}
