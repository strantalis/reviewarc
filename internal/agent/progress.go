package agent

import "time"

// ProgressGate lets distinct provider activity through immediately while
// rate-limiting repeated partial-output events. It keeps the UI timestamp tied
// to real harness output without emitting one application event per token.
type ProgressGate struct {
	interval    time.Duration
	lastMessage string
	lastAt      time.Time
}

func NewProgressGate(interval time.Duration) *ProgressGate {
	return &ProgressGate{interval: interval}
}

func (g *ProgressGate) Allow(message string, now time.Time) bool {
	if message == "" {
		return false
	}
	if message != g.lastMessage || g.lastAt.IsZero() || now.Sub(g.lastAt) >= g.interval {
		g.lastMessage = message
		g.lastAt = now
		return true
	}
	return false
}
