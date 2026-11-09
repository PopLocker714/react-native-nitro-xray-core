//go:build android || ios || diagnosticstest

package main

import (
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestDiagnosticLimitsAndFatalRetention(t *testing.T) {
	ClearDiagnostics()
	diagnosticRecord("xray", "go", "fatal")
	var workers sync.WaitGroup
	for n := 0; n < 8; n++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for i := 0; i < 2000; i++ {
				diagnosticRecord("olcrtc", "go", "logger_started")
			}
		}()
	}
	workers.Wait()
	diagnostics.Lock()
	defer diagnostics.Unlock()
	if len(diagnostics.entries) > 1024 || diagnostics.bytes > 256*1024 || diagnostics.dropped == 0 {
		t.Fatal("ring overflow or missing drops")
	}
	found := false
	for _, entry := range diagnostics.entries {
		if entry.bytes > 512 {
			t.Fatal("entry overflow")
		}
		if entry.event.Code == "fatal" {
			found = true
		}
	}
	if !found {
		t.Fatal("fatal evicted by noisy lifecycle")
	}
}
func TestDiagnosticTTL(t *testing.T) {
	ClearDiagnostics()
	diagnosticRecord("xray", "go", "engine_started")
	diagnostics.Lock()
	diagnosticPrune(time.Now().Add(11 * time.Minute))
	defer diagnostics.Unlock()
	if len(diagnostics.entries) != 0 || diagnostics.bytes != 0 {
		t.Fatal("expired events retained")
	}
}
func TestUnknownLinesNeverEnterBuffer(t *testing.T) {
	ClearDiagnostics()
	for _, line := range []string{"https://secret.example/key", "Link connected https://secret.example", "eyJ.token.signature", "a@b.example", "192.0.2.1"} {
		(olcrtcLogWriter{}).WriteLog(line)
	}
	diagnostics.Lock()
	defer diagnostics.Unlock()
	if len(diagnostics.entries) != 0 || diagnostics.dropped != 5 {
		t.Fatal("unknown line not dropped")
	}
}
func TestKnownOlcrtcLine(t *testing.T) {
	ClearDiagnostics()
	(olcrtcLogWriter{}).WriteLog("2026/11/09 12:00:00 goolom: full reconnect triggered\n")
	diagnostics.Lock()
	defer diagnostics.Unlock()
	if len(diagnostics.entries) != 1 || diagnostics.entries[0].event.Code != "reconnect" {
		t.Fatal("known classifier mismatch")
	}
	encoded, _ := json.Marshal(diagnostics.entries)
	if strings.Contains(string(encoded), "goolom:") {
		t.Fatal("raw line leaked")
	}
}
func TestAttemptIdentityNotReusedAfterClear(t *testing.T) {
	BeginDiagnosticAttempt()
	before := diagnosticCurrentAttempt()
	ClearDiagnostics()
	BeginDiagnosticAttempt()
	if diagnosticCurrentAttempt() <= before {
		t.Fatal("attempt reused")
	}
}

func TestSnapshotPaginationAndClear(t *testing.T) {
	ClearDiagnostics()
	for i := 0; i < 1100; i++ {
		diagnosticRecord("xray", "go", "engine_started")
	}
	after := uint64(0)
	count := 0
	for {
		raw := diagnosticSnapshotJSON(after)
		if len(raw) > 32768 {
			t.Fatal("page overflow")
		}
		var page struct {
			Events []diagnosticEvent
			Next   uint64
			More   bool
		}
		if err := json.Unmarshal([]byte(raw), &page); err != nil {
			t.Fatal(err)
		}
		for _, event := range page.Events {
			if event.Seq <= after {
				t.Fatal("cursor did not advance")
			}
			after = event.Seq
			count++
		}
		if page.Next != after {
			t.Fatal("wrong next cursor")
		}
		if !page.More {
			break
		}
	}
	if count != 1024 {
		t.Fatalf("wanted bounded history, got %d", count)
	}
	ClearDiagnostics()
	var page struct{ Events []diagnosticEvent }
	if err := json.Unmarshal([]byte(diagnosticSnapshotJSON(0)), &page); err != nil || len(page.Events) != 0 {
		t.Fatal("clear failed")
	}
}
