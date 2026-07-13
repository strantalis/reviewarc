package update

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

const defaultCheckInterval = 4 * time.Hour

// Service coordinates channel policy, scheduling, shared state, and a native
// Adapter. Its exported methods are safe for concurrent use.
type Service struct {
	adapter Adapter
	store   ChannelStore
	sink    StatusSink
	opts    Options

	mu                  sync.RWMutex
	status              Status
	started             bool
	checkActive         bool
	channelChangeActive bool
	trigger             chan struct{}
}

func NewService(adapter Adapter, store ChannelStore, sink StatusSink, opts Options) *Service {
	if adapter == nil {
		adapter = UnsupportedAdapter{}
	}
	if !opts.DefaultChannel.Valid() {
		opts.DefaultChannel = ChannelStable
	}
	if opts.CheckInterval == 0 {
		opts.CheckInterval = defaultCheckInterval
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	return &Service{
		adapter: adapter,
		store:   store,
		sink:    sink,
		opts:    opts,
		status: Status{
			State:   StateIdle,
			Channel: opts.DefaultChannel,
		},
		trigger: make(chan struct{}, 1),
	}
}

// Start loads the channel preference, initializes the adapter, and starts the
// background scheduler. Cancelling ctx stops future scheduled checks; it does
// not force-cancel a native installer already in progress.
func (s *Service) Start(ctx context.Context) error {
	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return ErrAlreadyStarted
	}
	s.started = true
	s.mu.Unlock()

	channel := s.opts.DefaultChannel
	if s.store != nil {
		stored, err := s.store.LoadChannel(ctx)
		if err != nil {
			s.failStart(fmt.Errorf("load update channel: %w", err))
			return fmt.Errorf("load update channel: %w", err)
		}
		if stored != "" {
			if err := validateChannel(stored); err != nil {
				s.failStart(fmt.Errorf("load update channel: %w", err))
				return fmt.Errorf("load update channel: %w", err)
			}
			channel = stored
		}
	}

	s.mu.Lock()
	s.status.Channel = channel
	s.mu.Unlock()

	if err := s.adapter.Initialize(ctx, channel, s.report); err != nil {
		if errors.Is(err, ErrUnsupported) {
			s.mu.Lock()
			s.status.State = StateUnsupported
			status := cloneStatus(s.status)
			s.mu.Unlock()
			s.publish(status)
			return nil
		}
		s.failStart(fmt.Errorf("initialize updater: %w", err))
		return fmt.Errorf("initialize updater: %w", err)
	}

	s.publish(s.Status())
	go s.run(ctx)
	if s.opts.CheckOnStart {
		s.requestCheck()
	}
	return nil
}

func (s *Service) failStart(err error) {
	s.mu.Lock()
	s.started = false
	s.status.State = StateFailed
	s.status.Error = err.Error()
	s.status.ErrorVisible = true
	status := cloneStatus(s.status)
	s.mu.Unlock()
	s.publish(status)
}

func (s *Service) run(ctx context.Context) {
	var ticker *time.Ticker
	var ticks <-chan time.Time
	if s.opts.CheckInterval > 0 {
		ticker = time.NewTicker(s.opts.CheckInterval)
		ticks = ticker.C
		defer ticker.Stop()
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.trigger:
			_ = s.Check(ctx, CheckScheduled)
		case <-ticks:
			_ = s.Check(ctx, CheckScheduled)
		}
	}
}

func (s *Service) Status() Status {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneStatus(s.status)
}

// SetChannel persists and applies a new channel, then requests an immediate
// background check. It never requests or permits a downgrade; adapter
// eligibility decides whether any newer release can be offered.
func (s *Service) SetChannel(ctx context.Context, channel Channel) error {
	if err := validateChannel(channel); err != nil {
		return err
	}

	s.mu.Lock()
	started := s.started
	current := s.status.Channel
	busy := s.checkActive || s.channelChangeActive || s.status.State == StateInstalling || s.status.State == StateReady
	unsupported := s.status.State == StateUnsupported
	if started && !unsupported && channel != current && !busy {
		s.channelChangeActive = true
	}
	s.mu.Unlock()
	if !started {
		return ErrNotStarted
	}
	if unsupported {
		return ErrUnsupported
	}
	if channel == current {
		return nil
	}
	if busy {
		return ErrBusy
	}

	if s.store != nil {
		if err := s.store.SaveChannel(ctx, channel); err != nil {
			s.finishChannelChange()
			return fmt.Errorf("save update channel: %w", err)
		}
	}
	if err := s.adapter.SetChannel(ctx, channel); err != nil {
		if s.store != nil {
			if rollbackErr := s.store.SaveChannel(ctx, current); rollbackErr != nil {
				s.finishChannelChange()
				return errors.Join(fmt.Errorf("set update channel: %w", err), fmt.Errorf("restore update channel: %w", rollbackErr))
			}
		}
		s.finishChannelChange()
		return fmt.Errorf("set update channel: %w", err)
	}

	s.mu.Lock()
	s.status.State = StateIdle
	s.status.Channel = channel
	s.status.Release = nil
	s.status.DownloadedBytes = 0
	s.status.TotalBytes = 0
	s.status.CheckMode = ""
	s.status.Error = ""
	s.status.ErrorVisible = false
	s.channelChangeActive = false
	status := cloneStatus(s.status)
	s.mu.Unlock()
	s.publish(status)
	s.requestCheck()
	return nil
}

func (s *Service) finishChannelChange() {
	s.mu.Lock()
	s.channelChangeActive = false
	s.mu.Unlock()
}

func (s *Service) requestCheck() {
	select {
	case s.trigger <- struct{}{}:
	default:
	}
}

// Check starts a manual or scheduled check. Native adapters report completion
// and download progress asynchronously through AdapterEvent.
func (s *Service) Check(ctx context.Context, mode CheckMode) error {
	if !mode.valid() {
		return ErrInvalidCheckMode
	}

	s.mu.Lock()
	if !s.started {
		s.mu.Unlock()
		return ErrNotStarted
	}
	if s.status.State == StateUnsupported {
		s.mu.Unlock()
		return ErrUnsupported
	}
	if s.checkActive || s.channelChangeActive || s.status.State == StateInstalling || s.status.State == StateReady {
		s.mu.Unlock()
		return ErrBusy
	}
	s.checkActive = true
	s.status.State = StateChecking
	s.status.Release = nil
	s.status.DownloadedBytes = 0
	s.status.TotalBytes = 0
	s.status.CheckMode = mode
	s.status.Error = ""
	s.status.ErrorVisible = false
	status := cloneStatus(s.status)
	s.mu.Unlock()
	s.publish(status)

	if err := s.adapter.Check(ctx, mode); err != nil {
		s.finishFailure(mode, fmt.Errorf("check for updates: %w", err))
		return fmt.Errorf("check for updates: %w", err)
	}
	return nil
}

// InstallAndRestart installs the release already downloaded by the adapter.
// The method never silently terminates the app; callers should invoke it only
// in response to an explicit user action.
func (s *Service) InstallAndRestart(ctx context.Context) error {
	s.mu.Lock()
	if !s.started {
		s.mu.Unlock()
		return ErrNotStarted
	}
	if s.status.State == StateUnsupported {
		s.mu.Unlock()
		return ErrUnsupported
	}
	if s.status.State != StateReady {
		s.mu.Unlock()
		return ErrNotReady
	}
	s.status.State = StateInstalling
	s.status.Error = ""
	s.status.ErrorVisible = false
	status := cloneStatus(s.status)
	s.mu.Unlock()
	s.publish(status)

	if err := s.adapter.InstallAndRestart(ctx); err != nil {
		wrapped := fmt.Errorf("install update: %w", err)
		s.mu.Lock()
		s.status.State = StateFailed
		s.status.Error = wrapped.Error()
		s.status.ErrorVisible = true
		status = cloneStatus(s.status)
		s.mu.Unlock()
		s.publish(status)
		return wrapped
	}
	return nil
}

func (s *Service) report(event AdapterEvent) {
	s.mu.Lock()
	if !s.started || s.status.State == StateUnsupported {
		s.mu.Unlock()
		return
	}
	// Native frameworks can send a final duplicate callback after their logical
	// operation has completed. In particular, installation is expected to exit
	// the process and Sparkle records idle while handing off to its installer.
	// Ignore those terminal echoes instead of turning a successful operation
	// into an application-visible state-machine error.
	if !s.checkActive && (s.status.State == StateInstalling || event.State == s.status.State && (event.State == StateIdle || event.State == StateReady)) {
		s.mu.Unlock()
		return
	}
	if err := s.applyEventLocked(event); err != nil {
		mode := s.status.CheckMode
		s.mu.Unlock()
		s.finishFailure(mode, err)
		return
	}
	status := cloneStatus(s.status)
	s.mu.Unlock()
	s.publish(status)
}

func (s *Service) applyEventLocked(event AdapterEvent) error {
	if !s.checkActive {
		return fmt.Errorf("%w: received %q without an active check", ErrInvalidEvent, event.State)
	}
	if !validTransition(s.status.State, event.State) {
		return fmt.Errorf("%w: cannot transition from %q to %q", ErrInvalidEvent, s.status.State, event.State)
	}
	if event.DownloadedBytes < 0 || event.TotalBytes < 0 || (event.TotalBytes > 0 && event.DownloadedBytes > event.TotalBytes) {
		return fmt.Errorf("%w: invalid download progress %d/%d", ErrInvalidEvent, event.DownloadedBytes, event.TotalBytes)
	}

	if event.Release != nil {
		s.status.Release = cloneRelease(event.Release)
	}
	if event.State == StateAvailable && s.status.Release == nil {
		return fmt.Errorf("%w: available event requires release metadata", ErrInvalidEvent)
	}
	if (event.State == StateDownloading || event.State == StateReady) && s.status.Release == nil {
		return fmt.Errorf("%w: %s event requires release metadata", ErrInvalidEvent, event.State)
	}

	s.status.State = event.State
	s.status.Error = ""
	s.status.ErrorVisible = false
	if event.State == StateDownloading || event.State == StateReady {
		s.status.DownloadedBytes = event.DownloadedBytes
		s.status.TotalBytes = event.TotalBytes
	}

	switch event.State {
	case StateIdle:
		s.checkActive = false
		s.status.Release = nil
		s.status.DownloadedBytes = 0
		s.status.TotalBytes = 0
		s.status.LastCheckedAt = timePointer(s.opts.Now())
	case StateAvailable:
		s.status.LastCheckedAt = timePointer(s.opts.Now())
	case StateReady:
		s.checkActive = false
		s.status.LastCheckedAt = timePointer(s.opts.Now())
	case StateFailed:
		return adapterFailure(event.Err)
	}
	return nil
}

func validTransition(from, to State) bool {
	switch from {
	case StateChecking:
		return to == StateIdle || to == StateAvailable || to == StateDownloading || to == StateReady || to == StateFailed
	case StateAvailable:
		return to == StateAvailable || to == StateDownloading || to == StateReady || to == StateIdle || to == StateFailed
	case StateDownloading:
		return to == StateDownloading || to == StateReady || to == StateFailed
	default:
		return false
	}
}

func adapterFailure(err error) error {
	if err == nil {
		return fmt.Errorf("%w: adapter reported failure without an error", ErrInvalidEvent)
	}
	return fmt.Errorf("update adapter: %w", err)
}

func (s *Service) finishFailure(mode CheckMode, err error) {
	s.mu.Lock()
	s.checkActive = false
	if mode == CheckScheduled {
		s.status.State = StateIdle
		s.status.Release = nil
		s.status.DownloadedBytes = 0
		s.status.TotalBytes = 0
		s.status.Error = ""
		s.status.ErrorVisible = false
	} else {
		s.status.State = StateFailed
		s.status.Error = err.Error()
		s.status.ErrorVisible = true
	}
	status := cloneStatus(s.status)
	s.mu.Unlock()
	s.publish(status)
}

func (s *Service) publish(status Status) {
	if s.sink != nil {
		s.sink(status)
	}
}

func cloneStatus(status Status) Status {
	status.Release = cloneRelease(status.Release)
	if status.LastCheckedAt != nil {
		checked := *status.LastCheckedAt
		status.LastCheckedAt = &checked
	}
	return status
}

func cloneRelease(release *Release) *Release {
	if release == nil {
		return nil
	}
	copy := *release
	return &copy
}

func timePointer(value time.Time) *time.Time { return &value }
