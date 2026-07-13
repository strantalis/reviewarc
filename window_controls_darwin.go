//go:build darwin && cgo

package main

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa

void configureReviewArcNativeWindowChrome(void);
void configureReviewArcApplicationMenu(void);
*/
import "C"

import (
	"context"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var (
	nativeUpdateMenuMu      sync.RWMutex
	nativeUpdateMenuHandler func()
)

func configureNativeWindowChrome(context.Context) {
	C.configureReviewArcNativeWindowChrome()
}

func configureNativeApplicationMenu(ctx context.Context) {
	nativeUpdateMenuMu.Lock()
	nativeUpdateMenuHandler = func() {
		runtime.WindowShow(ctx)
		runtime.WindowUnminimise(ctx)
		runtime.EventsEmit(ctx, "reviewarc:check-for-updates:v1")
	}
	nativeUpdateMenuMu.Unlock()
	C.configureReviewArcApplicationMenu()
}

//export reviewArcCheckForUpdates
func reviewArcCheckForUpdates() {
	nativeUpdateMenuMu.RLock()
	handler := nativeUpdateMenuHandler
	nativeUpdateMenuMu.RUnlock()
	if handler != nil {
		go handler()
	}
}
