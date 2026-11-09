//go:build android || ios || diagnosticstest

package main

/*
#include <stdlib.h>
*/
import "C"

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	applog "github.com/xtls/xray-core/app/log"
	corelog "github.com/xtls/xray-core/common/log"
	"github.com/xtls/xray-core/common/serial"
	"github.com/xtls/xray-core/core"
)

// No free text crosses this boundary. Access/DNS messages never enter the ring.
type diagnosticEvent struct {
	Seq        uint64 `json:"seq"`
	UTC        string `json:"utc"`
	ElapsedMs  int64  `json:"elapsedMs"`
	ClockScope string `json:"clockScope"`
	Attempt    uint64 `json:"attempt"`
	Source     string `json:"source"`
	Producer   string `json:"producer"`
	Phase      string `json:"phase"`
	Code       string `json:"code"`
	Severity   string `json:"severity"`
}
type diagnosticEntry struct {
	event diagnosticEvent
	at    time.Time
	bytes int
}

var diagnostics = struct {
	sync.Mutex
	started                          time.Time
	scope                            string
	seq, attempt, dropped, truncated uint64
	bytes                            int
	entries                          []diagnosticEntry
}{started: time.Now(), scope: fmt.Sprintf("go-%d", time.Now().UnixNano())}

var diagnosticCodes = map[string]string{
	"attempt_started": "info", "stopped": "info", "cancelled": "warning",
	"engine_started": "info", "parse_failed": "error", "init_failed": "error",
	"start_failed": "error", "stop_failed": "error", "already_running": "warning",
	"proxy_ready": "info", "proxy_timeout": "error", "logger_started": "info",
	"logger_closed": "info", "no_config": "error", "system_replay_denied": "warning",
	"fatal": "fatal", "proxy_retry_failed": "warning", "proxy_retry_timeout": "warning", "link_connected": "info", "reconnect": "warning", "session_accepted": "info",
}

func diagnosticPrune(now time.Time) {
	for len(diagnostics.entries) > 0 && now.Sub(diagnostics.entries[0].at) > 10*time.Minute {
		diagnostics.bytes -= diagnostics.entries[0].bytes
		diagnostics.entries = diagnostics.entries[1:]
		diagnostics.dropped++
	}
}
func diagnosticRecord(source, producer, code string) {
	// Asynchronous internal log callbacks cannot be reliably attributed to an attempt.
	diagnosticRecordAttempt(source, producer, code, 0)
}
func diagnosticCurrentAttempt() uint64 {
	diagnostics.Lock()
	defer diagnostics.Unlock()
	return diagnostics.attempt
}
func diagnosticRecordAttempt(source, producer, code string, attempt uint64) {
	severity, ok := diagnosticCodes[code]
	if !ok {
		return
	}
	diagnostics.Lock()
	defer diagnostics.Unlock()
	now := time.Now()
	diagnosticPrune(now)
	diagnostics.seq++
	e := diagnosticEvent{diagnostics.seq, now.UTC().Format(time.RFC3339Nano), now.Sub(diagnostics.started).Milliseconds(), diagnostics.scope, attempt, source, producer, "lifecycle", code, severity}
	encoded, _ := json.Marshal(e)
	if len(encoded) > 512 {
		diagnostics.truncated++
		return
	}
	// Reserve 128 entries / 64 KiB for terminal/lifecycle outcomes under a flood.
	maxCount, maxBytes := 1024, 256*1024
	if (source == "olcrtc" || code == "logger_started" || code == "logger_closed") && severity != "error" && severity != "fatal" {
		maxCount = 896
		maxBytes = 192 * 1024
	}
	for len(diagnostics.entries) >= maxCount || diagnostics.bytes+len(encoded) > maxBytes {
		victim := -1
		for i, v := range diagnostics.entries {
			if v.event.Severity != "fatal" && v.event.Severity != "error" {
				victim = i
				break
			}
		}
		if victim < 0 {
			if severity != "fatal" && severity != "error" {
				diagnostics.dropped++
				return
			}
			victim = 0
		}
		diagnostics.bytes -= diagnostics.entries[victim].bytes
		diagnostics.entries = append(diagnostics.entries[:victim], diagnostics.entries[victim+1:]...)
		diagnostics.dropped++
	}
	diagnostics.entries = append(diagnostics.entries, diagnosticEntry{e, now, len(encoded)})
	diagnostics.bytes += len(encoded)
}
func diagnosticUnknown() { diagnostics.Lock(); diagnostics.dropped++; diagnostics.Unlock() }

//export BeginDiagnosticAttempt
func BeginDiagnosticAttempt() {
	diagnostics.Lock()
	diagnostics.attempt++
	diagnostics.Unlock()
	diagnosticRecordAttempt("app", diagnosticProducer, "attempt_started", diagnosticCurrentAttempt())
}

//export RecordDiagnosticCode
func RecordDiagnosticCode(code C.int) {
	codes := []string{"cancelled", "stopped", "no_config", "system_replay_denied"}
	if code >= 0 && int(code) < len(codes) {
		diagnosticRecordAttempt("app", diagnosticProducer, codes[int(code)], diagnosticCurrentAttempt())
	}
}

//export ClearDiagnostics
func ClearDiagnostics() {
	diagnostics.Lock()
	defer diagnostics.Unlock()
	diagnostics.entries = nil
	diagnostics.bytes = 0
	diagnostics.dropped = 0
	diagnostics.truncated = 0
	// Sequence and attempt identities are never reused within this process.
}

//export GetDiagnosticSnapshot
func GetDiagnosticSnapshot(after C.ulonglong) *C.char {
	return C.CString(diagnosticSnapshotJSON(uint64(after)))
}

//export GetDiagnosticCheckpoint
func GetDiagnosticCheckpoint() *C.char           { return C.CString(diagnosticSnapshotPage(0, true)) }
func diagnosticSnapshotJSON(after uint64) string { return diagnosticSnapshotPage(after, false) }
func diagnosticSnapshotPage(after uint64, latest bool) string {
	diagnostics.Lock()
	defer diagnostics.Unlock()
	diagnosticPrune(time.Now())
	if latest {
		used := 0
		for i := len(diagnostics.entries) - 1; i >= 0; i-- {
			used += diagnostics.entries[i].bytes
			if used > 28*1024 {
				after = diagnostics.entries[i].event.Seq
				break
			}
		}
	}
	events := []diagnosticEvent{}
	next := uint64(after)
	used := 0
	more := false
	for _, entry := range diagnostics.entries {
		if entry.event.Seq <= uint64(after) {
			continue
		}
		if used+entry.bytes > 28*1024 {
			more = true
			break
		}
		events = append(events, entry.event)
		used += entry.bytes
		next = entry.event.Seq
	}
	data, _ := json.Marshal(struct {
		Available bool              `json:"available"`
		Events    []diagnosticEvent `json:"events"`
		Next      uint64            `json:"next"`
		More      bool              `json:"more"`
		Dropped   uint64            `json:"dropped"`
		Truncated uint64            `json:"truncated"`
		Probe     string            `json:"probe"`
	}{true, events, next, more, diagnostics.dropped, diagnostics.truncated, "unavailable"})
	return string(data)
}

type safeXrayHandler struct{}

func (safeXrayHandler) Handle(message corelog.Message) {
	general, ok := message.(*corelog.GeneralMessage)
	if !ok {
		return
	}
	// Only exact upstream lifecycle messages are known; no arbitrary Content serialization.
	content := fmt.Sprint(general.Content)
	switch content {
	case "Logger started", "app/log: Logger started":
		diagnosticRecord("xray", "go", "logger_started")
	case "Logger closed", "app/log: Logger closed":
		diagnosticRecord("xray", "go", "logger_closed")
	default:
		diagnosticUnknown()
	}
}
func init() {
	// app/log.New replaces common/log.RegisterHandler. Override creators instead,
	// including None: wrapper-generated configs normally turn logging off.
	for _, kind := range []applog.LogType{applog.LogType_Console, applog.LogType_File, applog.LogType_None} {
		if err := applog.RegisterHandlerCreator(kind, func(applog.LogType, applog.HandlerCreatorOptions) (corelog.Handler, error) {
			return safeXrayHandler{}, nil
		}); err != nil {
			panic(err)
		}
	}
}

type olcrtcLogWriter struct{}

func (olcrtcLogWriter) WriteLog(message string) {
	// Unknown lines, even ones containing familiar substrings, are discarded.
	// Wrapper lifecycle records below provide stable errors independent of upstream text.
	// mobile.logWriter receives standard log output; strip only the fixed timestamp prefix.
	if len(message) >= 20 && message[4] == '/' && message[7] == '/' && message[10] == ' ' && message[13] == ':' && message[16] == ':' {
		message = message[20:]
	}
	switch strings.TrimSuffix(message, "\n") {
	case "Link connected":
		diagnosticRecord("olcrtc", "go", "link_connected")
	case "goolom: full reconnect triggered":
		diagnosticRecord("olcrtc", "go", "reconnect")
	case "jitsi: session-accept sent":
		diagnosticRecord("olcrtc", "go", "session_accepted")
	default:
		diagnosticUnknown()
	}
}

// Force a safe logging policy even for consumer-supplied raw configs. No access,
// DNS, console or file writer survives. Debug only reaches the strict classifier.
func configureDiagnosticLogger(config *core.Config) {
	safe := serial.ToTypedMessage(&applog.Config{ErrorLogType: applog.LogType_Console,
		ErrorLogLevel: corelog.Severity_Debug, AccessLogType: applog.LogType_None})
	for i, app := range config.App {
		if app.Type == safe.Type {
			config.App[i] = safe
			return
		}
	}
	config.App = append(config.App, safe)
}
