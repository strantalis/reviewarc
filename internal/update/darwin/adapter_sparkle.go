//go:build darwin && cgo && sparkle

package darwin

/*
#cgo CFLAGS: -x objective-c -fobjc-arc -fblocks -F${SRCDIR}/../../../dist/sparkle -F${SRCDIR}/../../../build/darwin/updater/.deps
#cgo LDFLAGS: -framework Cocoa -framework Sparkle -F${SRCDIR}/../../../dist/sparkle -F${SRCDIR}/../../../build/darwin/updater/.deps

#include <stdlib.h>
#include "bridge.h"
*/
import "C"

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"
	"unsafe"

	"reviewarc/internal/update"
)

const statusPollInterval = 100 * time.Millisecond

type Adapter struct {
	feedURL string

	mu          sync.Mutex
	initialized bool
	report      func(update.AdapterEvent)
}

type nativeStatus struct {
	Revision        uint64 `json:"revision"`
	State           string `json:"state"`
	Version         string `json:"version"`
	Build           string `json:"build"`
	ReleaseNotesURL string `json:"releaseNotesURL"`
	ReceivedBytes   int64  `json:"receivedBytes"`
	TotalBytes      int64  `json:"totalBytes"`
	Error           string `json:"error"`
}

func New(feedURL string) update.Adapter {
	return &Adapter{feedURL: feedURL}
}

func (a *Adapter) Initialize(ctx context.Context, channel update.Channel, report func(update.AdapterEvent)) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !channel.Valid() {
		return fmt.Errorf("invalid update channel %q", channel)
	}
	if a.feedURL == "" {
		return errors.New("Sparkle feed URL is required")
	}
	if report == nil {
		return errors.New("Sparkle status reporter is required")
	}

	a.mu.Lock()
	if a.initialized {
		a.mu.Unlock()
		return errors.New("Sparkle adapter is already initialized")
	}
	a.mu.Unlock()

	feedURL := C.CString(a.feedURL)
	defer C.free(unsafe.Pointer(feedURL))
	if err := nativeCall(func(errorOut **C.char) C.int {
		return C.ra_sparkle_initialize(feedURL, boolInt(channel == update.ChannelBeta), errorOut)
	}); err != nil {
		return err
	}

	a.mu.Lock()
	a.initialized = true
	a.report = report
	a.mu.Unlock()
	go a.poll(ctx)
	return nil
}

func (a *Adapter) SetChannel(ctx context.Context, channel update.Channel) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !channel.Valid() {
		return fmt.Errorf("invalid update channel %q", channel)
	}
	if !a.isInitialized() {
		return errors.New("Sparkle adapter is not initialized")
	}
	return nativeCall(func(errorOut **C.char) C.int {
		return C.ra_sparkle_set_allows_beta(boolInt(channel == update.ChannelBeta), errorOut)
	})
}

func (a *Adapter) Check(ctx context.Context, mode update.CheckMode) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !a.isInitialized() {
		return errors.New("Sparkle adapter is not initialized")
	}
	if mode != update.CheckManual && mode != update.CheckScheduled {
		return fmt.Errorf("invalid update check mode %q", mode)
	}
	return nativeCall(func(errorOut **C.char) C.int {
		return C.ra_sparkle_check(boolInt(mode == update.CheckManual), errorOut)
	})
}

func (a *Adapter) InstallAndRestart(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !a.isInitialized() {
		return errors.New("Sparkle adapter is not initialized")
	}
	return nativeCall(func(errorOut **C.char) C.int {
		return C.ra_sparkle_install_and_restart(errorOut)
	})
}

func (a *Adapter) isInitialized() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.initialized
}

func (a *Adapter) poll(ctx context.Context) {
	ticker := time.NewTicker(statusPollInterval)
	defer ticker.Stop()
	var lastRevision uint64
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			status, err := readNativeStatus()
			if err != nil {
				a.emit(update.AdapterEvent{State: update.StateFailed, Err: err})
				return
			}
			if status.Revision == lastRevision {
				continue
			}
			lastRevision = status.Revision
			a.emit(status.event())
		}
	}
}

func (a *Adapter) emit(event update.AdapterEvent) {
	a.mu.Lock()
	report := a.report
	a.mu.Unlock()
	if report != nil {
		report(event)
	}
}

func (s nativeStatus) event() update.AdapterEvent {
	event := update.AdapterEvent{
		State:           update.State(s.State),
		DownloadedBytes: s.ReceivedBytes,
		TotalBytes:      s.TotalBytes,
	}
	if s.Version != "" || s.Build != "" || s.ReleaseNotesURL != "" {
		event.Release = &update.Release{
			Version:         s.Version,
			Build:           s.Build,
			ReleaseNotesURL: s.ReleaseNotesURL,
		}
	}
	if s.Error != "" {
		event.Err = errors.New(s.Error)
	}
	return event
}

func readNativeStatus() (nativeStatus, error) {
	value := C.ra_sparkle_status_json()
	if value == nil {
		return nativeStatus{}, errors.New("Sparkle returned an empty status")
	}
	defer C.ra_sparkle_free_string(value)

	var status nativeStatus
	if err := json.Unmarshal([]byte(C.GoString(value)), &status); err != nil {
		return nativeStatus{}, fmt.Errorf("decode Sparkle status: %w", err)
	}
	return status, nil
}

func nativeCall(call func(**C.char) C.int) error {
	var nativeError *C.char
	if call(&nativeError) != 0 {
		return nil
	}
	if nativeError == nil {
		return errors.New("Sparkle operation failed")
	}
	defer C.ra_sparkle_free_string(nativeError)
	return errors.New(C.GoString(nativeError))
}

func boolInt(value bool) C.int {
	if value {
		return 1
	}
	return 0
}

var _ update.Adapter = (*Adapter)(nil)
