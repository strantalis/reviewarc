package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"reviewarc/internal/buildinfo"
	"reviewarc/internal/persistence"
	"reviewarc/internal/update"
	updatedarwin "reviewarc/internal/update/darwin"
)

const (
	updateChannelSetting = "softwareUpdate.channel"
	updateFeedURL        = "https://www.reviewarc.dev/api/appcast.xml"
)

type updateChannelStore struct{ store *persistence.Store }

func (s updateChannelStore) LoadChannel(ctx context.Context) (update.Channel, error) {
	var channel update.Channel
	if err := s.store.GetSetting(ctx, updateChannelSetting, &channel); err != nil {
		if errors.Is(err, persistence.ErrNotFound) {
			return "", nil
		}
		return "", err
	}
	return channel, nil
}

func (s updateChannelStore) SaveChannel(ctx context.Context, channel update.Channel) error {
	return s.store.SetSetting(ctx, updateChannelSetting, channel)
}

// SoftwareUpdateStatus adds the running application's build metadata to the
// platform-independent updater state exposed to Wails.
type SoftwareUpdateStatus struct {
	update.Status
	CurrentVersion string `json:"currentVersion"`
	CurrentBuild   string `json:"currentBuild"`
}

func defaultUpdateChannel() update.Channel {
	channel := update.Channel(buildinfo.Channel)
	if !channel.Valid() {
		return update.ChannelStable
	}
	return channel
}

func (a *App) configureUpdater() {
	a.updater = update.NewService(
		updatedarwin.New(updateFeedURL),
		updateChannelStore{store: a.store},
		func(status update.Status) {
			runtime.EventsEmit(a.appContext(), "reviewarc:update:v1", softwareUpdateStatus(status))
		},
		update.Options{
			DefaultChannel: defaultUpdateChannel(),
			CheckInterval:  24 * time.Hour,
			CheckOnStart:   true,
		},
	)
}

func softwareUpdateStatus(status update.Status) SoftwareUpdateStatus {
	return SoftwareUpdateStatus{
		Status:         status,
		CurrentVersion: buildinfo.Version,
		CurrentBuild:   buildinfo.BuildNumber,
	}
}

func (a *App) GetUpdateStatus() SoftwareUpdateStatus {
	if a.updater == nil {
		return softwareUpdateStatus(update.Status{State: update.StateUnsupported, Channel: defaultUpdateChannel()})
	}
	return softwareUpdateStatus(a.updater.Status())
}

func (a *App) CheckForUpdates() (SoftwareUpdateStatus, error) {
	if a.updater == nil {
		return a.GetUpdateStatus(), update.ErrUnsupported
	}
	if err := a.updater.Check(a.appContext(), update.CheckManual); err != nil {
		return a.GetUpdateStatus(), err
	}
	return a.GetUpdateStatus(), nil
}

func (a *App) SetUpdateChannel(raw string) (SoftwareUpdateStatus, error) {
	if a.updater == nil {
		return a.GetUpdateStatus(), update.ErrUnsupported
	}
	channel := update.Channel(raw)
	if !channel.Valid() {
		return a.GetUpdateStatus(), fmt.Errorf("%w: %q", update.ErrInvalidChannel, raw)
	}
	if err := a.updater.SetChannel(a.appContext(), channel); err != nil {
		return a.GetUpdateStatus(), err
	}
	return a.GetUpdateStatus(), nil
}

func (a *App) InstallUpdate() error {
	if a.updater == nil {
		return update.ErrUnsupported
	}
	return a.updater.InstallAndRestart(a.appContext())
}
