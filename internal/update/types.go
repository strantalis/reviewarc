// Package update provides ReviewArc's platform-independent application update
// policy. Platform adapters are responsible for determining whether a release
// is newer and eligible for installation; this package intentionally does not
// compare platform-specific version or build identifiers.
package update

import (
	"context"
	"errors"
	"fmt"
	"time"
)

type Channel string

const (
	ChannelStable Channel = "stable"
	ChannelBeta   Channel = "beta"
)

func (c Channel) Valid() bool {
	return c == ChannelStable || c == ChannelBeta
}

type State string

const (
	StateIdle        State = "idle"
	StateChecking    State = "checking"
	StateAvailable   State = "available"
	StateDownloading State = "downloading"
	StateReady       State = "ready"
	StateInstalling  State = "installing"
	StateFailed      State = "failed"
	StateUnsupported State = "unsupported"
)

type CheckMode string

const (
	CheckManual    CheckMode = "manual"
	CheckScheduled CheckMode = "scheduled"
)

func (m CheckMode) valid() bool {
	return m == CheckManual || m == CheckScheduled
}

// Release is display metadata for a platform adapter's eligible update.
// Build is deliberately opaque because build identifiers are platform-specific.
type Release struct {
	Version         string `json:"version"`
	Build           string `json:"build"`
	ReleaseNotesURL string `json:"releaseNotesUrl"`
}

// Status is the canonical state exposed to the application and frontend.
// Error is populated only for failures that should be shown to the user.
type Status struct {
	State           State      `json:"state"`
	Channel         Channel    `json:"channel"`
	Release         *Release   `json:"release,omitempty"`
	DownloadedBytes int64      `json:"downloadedBytes"`
	TotalBytes      int64      `json:"totalBytes"`
	LastCheckedAt   *time.Time `json:"lastCheckedAt,omitempty"`
	CheckMode       CheckMode  `json:"checkMode,omitempty"`
	Error           string     `json:"error"`
	ErrorVisible    bool       `json:"errorVisible"`
}

// AdapterEvent reports native update progress to Service. Adapters may emit
// idle, available, downloading, ready, or failed. Service owns checking and
// installing transitions.
type AdapterEvent struct {
	State           State
	Release         *Release
	DownloadedBytes int64
	TotalBytes      int64
	Err             error
}

// Adapter bridges the shared policy to a platform-native update mechanism.
//
// Check may return after starting asynchronous native work. The adapter must
// use report until it emits a terminal idle, ready, or failed event. Candidate
// eligibility, including forward-only/no-downgrade behavior, belongs here.
type Adapter interface {
	Initialize(ctx context.Context, channel Channel, report func(AdapterEvent)) error
	SetChannel(ctx context.Context, channel Channel) error
	Check(ctx context.Context, mode CheckMode) error
	InstallAndRestart(ctx context.Context) error
}

// ChannelStore persists the user's selected release channel. An empty channel
// returned by LoadChannel means no preference has been saved yet.
type ChannelStore interface {
	LoadChannel(ctx context.Context) (Channel, error)
	SaveChannel(ctx context.Context, channel Channel) error
}

type StatusSink func(Status)

type Options struct {
	DefaultChannel Channel
	CheckInterval  time.Duration
	CheckOnStart   bool
	Now            func() time.Time
}

var (
	ErrUnsupported      = errors.New("updates are not supported on this platform")
	ErrNotStarted       = errors.New("update service is not started")
	ErrAlreadyStarted   = errors.New("update service is already started")
	ErrBusy             = errors.New("an update operation is already in progress")
	ErrNotReady         = errors.New("no update is available to install")
	ErrInvalidChannel   = errors.New("invalid update channel")
	ErrInvalidCheckMode = errors.New("invalid update check mode")
	ErrInvalidEvent     = errors.New("invalid platform update event")
)

func validateChannel(channel Channel) error {
	if !channel.Valid() {
		return fmt.Errorf("%w: %q", ErrInvalidChannel, channel)
	}
	return nil
}

// UnsupportedAdapter is used by builds without a native update implementation.
// Service converts its initialization result into StateUnsupported without
// treating application startup as a failure.
type UnsupportedAdapter struct{}

func (UnsupportedAdapter) Initialize(context.Context, Channel, func(AdapterEvent)) error {
	return ErrUnsupported
}

func (UnsupportedAdapter) SetChannel(context.Context, Channel) error { return ErrUnsupported }
func (UnsupportedAdapter) Check(context.Context, CheckMode) error    { return ErrUnsupported }
func (UnsupportedAdapter) InstallAndRestart(context.Context) error   { return ErrUnsupported }
