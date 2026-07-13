package main

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"reviewarc/internal/persistence"
	"reviewarc/internal/update"
)

func TestUpdateChannelStoreDefaultsAndPersists(t *testing.T) {
	store, err := persistence.Open(filepath.Join(t.TempDir(), "reviewarc.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	channels := updateChannelStore{store: store}
	channel, err := channels.LoadChannel(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if channel != "" {
		t.Fatalf("initial channel = %q, want unset", channel)
	}
	if err := channels.SaveChannel(context.Background(), update.ChannelBeta); err != nil {
		t.Fatal(err)
	}
	channel, err = channels.LoadChannel(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if channel != update.ChannelBeta {
		t.Fatalf("saved channel = %q, want %q", channel, update.ChannelBeta)
	}
}

func TestSoftwareUpdateMethodsFailClosedWithoutConfiguredService(t *testing.T) {
	app := &App{}
	status := app.GetUpdateStatus()
	if status.State != update.StateUnsupported || status.Channel != update.ChannelStable {
		t.Fatalf("status = %#v", status)
	}
	if _, err := app.CheckForUpdates(); !errors.Is(err, update.ErrUnsupported) {
		t.Fatalf("CheckForUpdates error = %v", err)
	}
	if _, err := app.SetUpdateChannel("nightly"); !errors.Is(err, update.ErrUnsupported) {
		t.Fatalf("SetUpdateChannel error = %v", err)
	}
	if err := app.InstallUpdate(); !errors.Is(err, update.ErrUnsupported) {
		t.Fatalf("InstallUpdate error = %v", err)
	}
}
