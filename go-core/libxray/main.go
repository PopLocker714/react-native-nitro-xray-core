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
	_ "github.com/xtls/xray-core/main/distro/all"
)

var runningServer core.Server

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

func main() {}
