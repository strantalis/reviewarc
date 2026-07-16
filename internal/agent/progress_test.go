package agent

import (
	"testing"
	"time"
)

func TestProgressGateReportsDistinctAndSustainedObservedActivity(t *testing.T) {
	gate := NewProgressGate(10 * time.Second)
	started := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)

	if !gate.Allow("Reasoning about the change", started) {
		t.Fatal("first observed activity was suppressed")
	}
	if gate.Allow("Reasoning about the change", started.Add(9*time.Second)) {
		t.Fatal("repeated partial activity was not rate-limited")
	}
	if !gate.Allow("Composing the structured review", started.Add(9*time.Second)) {
		t.Fatal("a distinct provider phase was suppressed")
	}
	if !gate.Allow("Composing the structured review", started.Add(19*time.Second)) {
		t.Fatal("sustained observed activity was not reported")
	}
	if gate.Allow("", started.Add(30*time.Second)) {
		t.Fatal("empty activity was reported")
	}
}
