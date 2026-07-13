//go:build darwin && cgo && sparkle

package darwin

import (
	"testing"

	"reviewarc/internal/update"
)

func TestNativeStatusEvent(t *testing.T) {
	t.Parallel()

	status := nativeStatus{
		State:           string(update.StateDownloading),
		Version:         "0.3.0-beta.2",
		Build:           "142",
		ReleaseNotesURL: "https://reviewarc.app/releases/0.3.0-beta.2",
		ReceivedBytes:   20,
		TotalBytes:      100,
	}
	event := status.event()

	if event.State != update.StateDownloading {
		t.Fatalf("State = %q, want %q", event.State, update.StateDownloading)
	}
	if event.Release == nil || event.Release.Build != "142" || event.Release.Version != "0.3.0-beta.2" {
		t.Fatalf("Release = %#v", event.Release)
	}
	if event.DownloadedBytes != 20 || event.TotalBytes != 100 {
		t.Fatalf("progress = %d/%d", event.DownloadedBytes, event.TotalBytes)
	}
}

func TestNativeStatusEventFailure(t *testing.T) {
	t.Parallel()

	event := (nativeStatus{State: string(update.StateFailed), Error: "bad signature"}).event()
	if event.Err == nil || event.Err.Error() != "bad signature" {
		t.Fatalf("Err = %v", event.Err)
	}
}
