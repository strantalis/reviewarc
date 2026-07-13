package update

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeAdapter struct {
	mu sync.Mutex

	initializeErr error
	setChannelErr error
	checkErr      error
	installErr    error

	initialized Channel
	channel     Channel
	report      func(AdapterEvent)
	checks      chan CheckMode
	installs    int
	setStarted  chan struct{}
	setContinue chan struct{}
}

func newFakeAdapter() *fakeAdapter {
	return &fakeAdapter{checks: make(chan CheckMode, 16)}
}

func (f *fakeAdapter) Initialize(_ context.Context, channel Channel, report func(AdapterEvent)) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.initialized = channel
	f.channel = channel
	f.report = report
	return f.initializeErr
}

func (f *fakeAdapter) SetChannel(_ context.Context, channel Channel) error {
	if f.setStarted != nil {
		close(f.setStarted)
		<-f.setContinue
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.setChannelErr != nil {
		return f.setChannelErr
	}
	f.channel = channel
	return nil
}

func (f *fakeAdapter) Check(_ context.Context, mode CheckMode) error {
	f.mu.Lock()
	err := f.checkErr
	f.mu.Unlock()
	f.checks <- mode
	return err
}

func (f *fakeAdapter) InstallAndRestart(context.Context) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.installs++
	return f.installErr
}

func (f *fakeAdapter) emit(event AdapterEvent) {
	f.mu.Lock()
	report := f.report
	f.mu.Unlock()
	if report != nil {
		report(event)
	}
}

func (f *fakeAdapter) currentChannel() Channel {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.channel
}

type fakeStore struct {
	mu sync.Mutex

	channel Channel
	loadErr error
	saveErr error
	saves   []Channel
}

func (f *fakeStore) LoadChannel(context.Context) (Channel, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.channel, f.loadErr
}

func (f *fakeStore) SaveChannel(_ context.Context, channel Channel) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.saves = append(f.saves, channel)
	if f.saveErr != nil {
		return f.saveErr
	}
	f.channel = channel
	return nil
}

type statusRecorder struct {
	mu       sync.Mutex
	statuses []Status
}

func (r *statusRecorder) record(status Status) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.statuses = append(r.statuses, status)
}

func (r *statusRecorder) snapshot() []Status {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]Status(nil), r.statuses...)
}

func startService(t *testing.T, adapter Adapter, store ChannelStore, sink StatusSink, opts Options) (*Service, context.CancelFunc) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	service := NewService(adapter, store, sink, opts)
	if err := service.Start(ctx); err != nil {
		cancel()
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(cancel)
	return service, cancel
}

func receiveCheck(t *testing.T, checks <-chan CheckMode) CheckMode {
	t.Helper()
	select {
	case mode := <-checks:
		return mode
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for adapter check")
		return ""
	}
}

func TestStartLoadsSavedChannel(t *testing.T) {
	adapter := newFakeAdapter()
	store := &fakeStore{channel: ChannelBeta}
	service, _ := startService(t, adapter, store, nil, Options{DefaultChannel: ChannelStable, CheckInterval: -1})

	if adapter.initialized != ChannelBeta {
		t.Fatalf("initialized channel = %q, want beta", adapter.initialized)
	}
	if got := service.Status(); got.State != StateIdle || got.Channel != ChannelBeta {
		t.Fatalf("status = %#v", got)
	}
}

func TestStartUsesStableAsSafeDefault(t *testing.T) {
	adapter := newFakeAdapter()
	service, _ := startService(t, adapter, &fakeStore{}, nil, Options{DefaultChannel: "invalid", CheckInterval: -1})

	if got := service.Status().Channel; got != ChannelStable {
		t.Fatalf("channel = %q, want stable", got)
	}
}

func TestStartRejectsCorruptSavedChannel(t *testing.T) {
	service := NewService(newFakeAdapter(), &fakeStore{channel: "nightly"}, nil, Options{CheckInterval: -1})
	err := service.Start(context.Background())
	if !errors.Is(err, ErrInvalidChannel) {
		t.Fatalf("Start() error = %v, want ErrInvalidChannel", err)
	}
	status := service.Status()
	if status.State != StateFailed || !status.ErrorVisible || !strings.Contains(status.Error, "nightly") {
		t.Fatalf("status = %#v", status)
	}
}

func TestUnsupportedAdapterStartsCleanly(t *testing.T) {
	recorder := &statusRecorder{}
	service, _ := startService(t, UnsupportedAdapter{}, nil, recorder.record, Options{CheckInterval: -1})

	if got := service.Status(); got.State != StateUnsupported || got.Error != "" || got.ErrorVisible {
		t.Fatalf("status = %#v", got)
	}
	if err := service.Check(context.Background(), CheckManual); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("Check() error = %v, want ErrUnsupported", err)
	}
}

func TestManualCheckDrivesBackgroundDownloadState(t *testing.T) {
	adapter := newFakeAdapter()
	recorder := &statusRecorder{}
	now := time.Date(2026, 7, 13, 10, 30, 0, 0, time.UTC)
	service, _ := startService(t, adapter, nil, recorder.record, Options{CheckInterval: -1, Now: func() time.Time { return now }})

	if err := service.Check(context.Background(), CheckManual); err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if got := receiveCheck(t, adapter.checks); got != CheckManual {
		t.Fatalf("mode = %q, want manual", got)
	}
	release := &Release{Version: "1.2.0-beta.2", Build: "204", ReleaseNotesURL: "https://example.test/notes"}
	adapter.emit(AdapterEvent{State: StateAvailable, Release: release})
	release.Version = "mutated by adapter"
	adapter.emit(AdapterEvent{State: StateDownloading, DownloadedBytes: 25, TotalBytes: 100})
	adapter.emit(AdapterEvent{State: StateReady, DownloadedBytes: 100, TotalBytes: 100})

	got := service.Status()
	if got.State != StateReady || got.Release == nil || got.Release.Version != "1.2.0-beta.2" {
		t.Fatalf("status = %#v", got)
	}
	if got.DownloadedBytes != 100 || got.TotalBytes != 100 || got.LastCheckedAt == nil || !got.LastCheckedAt.Equal(now) {
		t.Fatalf("status progress/time = %#v", got)
	}
	states := recorder.snapshot()
	wantTail := []State{StateChecking, StateAvailable, StateDownloading, StateReady}
	if len(states) < len(wantTail) {
		t.Fatalf("recorded states = %#v", states)
	}
	states = states[len(states)-len(wantTail):]
	for i, want := range wantTail {
		if states[i].State != want {
			t.Fatalf("state[%d] = %q, want %q (all: %#v)", i, states[i].State, want, states)
		}
	}
}

func TestNoUpdateReturnsToIdleAndRecordsSuccessfulCheck(t *testing.T) {
	adapter := newFakeAdapter()
	now := time.Date(2026, 7, 13, 11, 0, 0, 0, time.UTC)
	service, _ := startService(t, adapter, nil, nil, Options{CheckInterval: -1, Now: func() time.Time { return now }})

	if err := service.Check(context.Background(), CheckManual); err != nil {
		t.Fatal(err)
	}
	adapter.emit(AdapterEvent{State: StateIdle})
	got := service.Status()
	if got.State != StateIdle || got.LastCheckedAt == nil || !got.LastCheckedAt.Equal(now) || got.Error != "" {
		t.Fatalf("status = %#v", got)
	}
}

func TestDuplicateTerminalCallbackIsIgnored(t *testing.T) {
	adapter := newFakeAdapter()
	service, _ := startService(t, adapter, nil, nil, Options{CheckInterval: -1})
	if err := service.Check(context.Background(), CheckManual); err != nil {
		t.Fatal(err)
	}
	adapter.emit(AdapterEvent{State: StateIdle})
	adapter.emit(AdapterEvent{State: StateIdle})

	if got := service.Status(); got.State != StateIdle || got.ErrorVisible || got.Error != "" {
		t.Fatalf("duplicate callback changed terminal status: %#v", got)
	}
}

func TestManualCheckFailureIsVisible(t *testing.T) {
	adapter := newFakeAdapter()
	adapter.checkErr = errors.New("network unavailable")
	service, _ := startService(t, adapter, nil, nil, Options{CheckInterval: -1})

	err := service.Check(context.Background(), CheckManual)
	if err == nil || !strings.Contains(err.Error(), "network unavailable") {
		t.Fatalf("Check() error = %v", err)
	}
	got := service.Status()
	if got.State != StateFailed || !got.ErrorVisible || !strings.Contains(got.Error, "network unavailable") {
		t.Fatalf("status = %#v", got)
	}
}

func TestScheduledCheckFailureIsQuiet(t *testing.T) {
	adapter := newFakeAdapter()
	service, _ := startService(t, adapter, nil, nil, Options{CheckInterval: -1})

	if err := service.Check(context.Background(), CheckScheduled); err != nil {
		t.Fatal(err)
	}
	adapter.emit(AdapterEvent{State: StateFailed, Err: errors.New("offline")})
	got := service.Status()
	if got.State != StateIdle || got.ErrorVisible || got.Error != "" {
		t.Fatalf("scheduled failure leaked to status: %#v", got)
	}
}

func TestInvalidAdapterTransitionFailsClosed(t *testing.T) {
	adapter := newFakeAdapter()
	service, _ := startService(t, adapter, nil, nil, Options{CheckInterval: -1})
	if err := service.Check(context.Background(), CheckManual); err != nil {
		t.Fatal(err)
	}

	adapter.emit(AdapterEvent{State: StateInstalling})
	got := service.Status()
	if got.State != StateFailed || !got.ErrorVisible || !strings.Contains(got.Error, "invalid platform update event") {
		t.Fatalf("status = %#v", got)
	}
}

func TestInvalidProgressFailsClosed(t *testing.T) {
	adapter := newFakeAdapter()
	service, _ := startService(t, adapter, nil, nil, Options{CheckInterval: -1})
	if err := service.Check(context.Background(), CheckManual); err != nil {
		t.Fatal(err)
	}
	adapter.emit(AdapterEvent{
		State:           StateDownloading,
		Release:         &Release{Version: "2.0.0", Build: "200"},
		DownloadedBytes: 101,
		TotalBytes:      100,
	})

	if got := service.Status(); got.State != StateFailed || !strings.Contains(got.Error, "invalid download progress") {
		t.Fatalf("status = %#v", got)
	}
}

func TestCheckRejectsConcurrentWorkAndReadyRelease(t *testing.T) {
	adapter := newFakeAdapter()
	service, _ := startService(t, adapter, nil, nil, Options{CheckInterval: -1})
	if err := service.Check(context.Background(), CheckManual); err != nil {
		t.Fatal(err)
	}
	if err := service.Check(context.Background(), CheckManual); !errors.Is(err, ErrBusy) {
		t.Fatalf("concurrent Check() error = %v, want ErrBusy", err)
	}
	adapter.emit(AdapterEvent{State: StateReady, Release: &Release{Version: "2.0.0", Build: "200"}})
	if err := service.Check(context.Background(), CheckManual); !errors.Is(err, ErrBusy) {
		t.Fatalf("ready Check() error = %v, want ErrBusy", err)
	}
}

func TestSetChannelPersistsAppliesAndTriggersScheduledCheck(t *testing.T) {
	adapter := newFakeAdapter()
	store := &fakeStore{channel: ChannelStable}
	service, _ := startService(t, adapter, store, nil, Options{CheckInterval: -1})

	if err := service.SetChannel(context.Background(), ChannelBeta); err != nil {
		t.Fatalf("SetChannel() error = %v", err)
	}
	if got := receiveCheck(t, adapter.checks); got != CheckScheduled {
		t.Fatalf("triggered mode = %q, want scheduled", got)
	}
	if adapter.currentChannel() != ChannelBeta || store.channel != ChannelBeta || service.Status().Channel != ChannelBeta {
		t.Fatalf("channels: adapter=%q store=%q status=%q", adapter.currentChannel(), store.channel, service.Status().Channel)
	}
	if got := service.Status(); got.State != StateChecking || got.ErrorVisible {
		t.Fatalf("status = %#v", got)
	}
}

func TestSetChannelRejectsDownloadedRelease(t *testing.T) {
	adapter := newFakeAdapter()
	store := &fakeStore{channel: ChannelStable}
	service, _ := startService(t, adapter, store, nil, Options{CheckInterval: -1})
	if err := service.Check(context.Background(), CheckManual); err != nil {
		t.Fatal(err)
	}
	adapter.emit(AdapterEvent{State: StateReady, Release: &Release{Version: "2.0.0-beta.1", Build: "200"}})

	if err := service.SetChannel(context.Background(), ChannelBeta); !errors.Is(err, ErrBusy) {
		t.Fatalf("SetChannel() error = %v, want ErrBusy", err)
	}
	if adapter.currentChannel() != ChannelStable || store.channel != ChannelStable || service.Status().Channel != ChannelStable {
		t.Fatalf("ready update changed channels: adapter=%q store=%q status=%q", adapter.currentChannel(), store.channel, service.Status().Channel)
	}
}

func TestSetChannelSerializesChecks(t *testing.T) {
	adapter := newFakeAdapter()
	adapter.setStarted = make(chan struct{})
	adapter.setContinue = make(chan struct{})
	service, _ := startService(t, adapter, &fakeStore{channel: ChannelStable}, nil, Options{CheckInterval: -1})

	result := make(chan error, 1)
	go func() { result <- service.SetChannel(context.Background(), ChannelBeta) }()
	select {
	case <-adapter.setStarted:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for native channel change")
	}
	if err := service.Check(context.Background(), CheckManual); !errors.Is(err, ErrBusy) {
		t.Fatalf("Check() during channel change error = %v, want ErrBusy", err)
	}
	close(adapter.setContinue)
	if err := <-result; err != nil {
		t.Fatalf("SetChannel() error = %v", err)
	}
	if got := receiveCheck(t, adapter.checks); got != CheckScheduled {
		t.Fatalf("post-change check mode = %q, want scheduled", got)
	}
}

func TestSetChannelRollsBackPersistenceWhenAdapterFails(t *testing.T) {
	adapter := newFakeAdapter()
	adapter.setChannelErr = errors.New("native rejection")
	store := &fakeStore{channel: ChannelStable}
	service, _ := startService(t, adapter, store, nil, Options{CheckInterval: -1})

	err := service.SetChannel(context.Background(), ChannelBeta)
	if err == nil || !strings.Contains(err.Error(), "native rejection") {
		t.Fatalf("SetChannel() error = %v", err)
	}
	if store.channel != ChannelStable || service.Status().Channel != ChannelStable {
		t.Fatalf("rollback failed: store=%q status=%q", store.channel, service.Status().Channel)
	}
	if len(store.saves) != 2 || store.saves[0] != ChannelBeta || store.saves[1] != ChannelStable {
		t.Fatalf("saves = %#v", store.saves)
	}
}

func TestSetChannelDoesNotTriggerWhenUnchanged(t *testing.T) {
	adapter := newFakeAdapter()
	service, _ := startService(t, adapter, &fakeStore{channel: ChannelStable}, nil, Options{CheckInterval: -1})
	if err := service.SetChannel(context.Background(), ChannelStable); err != nil {
		t.Fatal(err)
	}
	select {
	case mode := <-adapter.checks:
		t.Fatalf("unexpected check: %q", mode)
	case <-time.After(20 * time.Millisecond):
	}
}

func TestInstallRequiresAvailableOrReadyAndIsExplicit(t *testing.T) {
	adapter := newFakeAdapter()
	service, _ := startService(t, adapter, nil, nil, Options{CheckInterval: -1})
	if err := service.InstallAndRestart(context.Background()); !errors.Is(err, ErrNotReady) {
		t.Fatalf("InstallAndRestart() error = %v, want ErrNotReady", err)
	}
	if adapter.installs != 0 {
		t.Fatalf("installs = %d before ready", adapter.installs)
	}

	if err := service.Check(context.Background(), CheckScheduled); err != nil {
		t.Fatal(err)
	}
	adapter.emit(AdapterEvent{State: StateAvailable, Release: &Release{Version: "2.0.0", Build: "200"}})
	if err := service.InstallAndRestart(context.Background()); err != nil {
		t.Fatalf("InstallAndRestart() available error = %v", err)
	}
	if adapter.installs != 1 || service.Status().State != StateDownloading {
		t.Fatalf("available installs=%d status=%#v", adapter.installs, service.Status())
	}
	adapter.emit(AdapterEvent{State: StateReady, Release: &Release{Version: "2.0.0", Build: "200"}})
	if err := service.InstallAndRestart(context.Background()); err != nil {
		t.Fatalf("InstallAndRestart() ready error = %v", err)
	}
	if adapter.installs != 2 || service.Status().State != StateInstalling {
		t.Fatalf("installs=%d status=%#v", adapter.installs, service.Status())
	}
	adapter.emit(AdapterEvent{State: StateIdle})
	if got := service.Status(); got.State != StateInstalling || got.ErrorVisible {
		t.Fatalf("post-install native callback changed status: %#v", got)
	}
}

func TestInstallFailureIsVisible(t *testing.T) {
	adapter := newFakeAdapter()
	adapter.installErr = errors.New("permission denied")
	service, _ := startService(t, adapter, nil, nil, Options{CheckInterval: -1})
	if err := service.Check(context.Background(), CheckScheduled); err != nil {
		t.Fatal(err)
	}
	adapter.emit(AdapterEvent{State: StateReady, Release: &Release{Version: "2.0.0", Build: "200"}})

	err := service.InstallAndRestart(context.Background())
	if err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("InstallAndRestart() error = %v", err)
	}
	if got := service.Status(); got.State != StateFailed || !got.ErrorVisible || !strings.Contains(got.Error, "permission denied") {
		t.Fatalf("status = %#v", got)
	}
}

func TestCheckOnStartUsesScheduledMode(t *testing.T) {
	adapter := newFakeAdapter()
	startService(t, adapter, nil, nil, Options{CheckInterval: -1, CheckOnStart: true})
	if got := receiveCheck(t, adapter.checks); got != CheckScheduled {
		t.Fatalf("mode = %q, want scheduled", got)
	}
}

func TestServiceDoesNotCompareOpaqueBuildIdentifiers(t *testing.T) {
	adapter := newFakeAdapter()
	service, _ := startService(t, adapter, nil, nil, Options{CheckInterval: -1})
	if err := service.Check(context.Background(), CheckManual); err != nil {
		t.Fatal(err)
	}

	// The shared service accepts the adapter's eligible result even though this
	// identifier is not numerically comparable. Forward-only policy therefore
	// stays in the platform adapter, where native version rules are available.
	adapter.emit(AdapterEvent{State: StateReady, Release: &Release{Version: "release-candidate", Build: "win-1.2.3.4"}})
	if got := service.Status(); got.State != StateReady || got.Release.Build != "win-1.2.3.4" {
		t.Fatalf("status = %#v", got)
	}
}

func TestStatusReturnsDefensiveCopy(t *testing.T) {
	adapter := newFakeAdapter()
	service, _ := startService(t, adapter, nil, nil, Options{CheckInterval: -1})
	if err := service.Check(context.Background(), CheckManual); err != nil {
		t.Fatal(err)
	}
	adapter.emit(AdapterEvent{State: StateReady, Release: &Release{Version: "2.0.0", Build: "200"}})

	first := service.Status()
	first.Release.Version = "changed"
	if second := service.Status(); second.Release.Version != "2.0.0" {
		t.Fatalf("service status was mutated through copy: %#v", second)
	}
}
