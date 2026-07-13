//go:build !darwin || !cgo || !sparkle

package darwin

import "reviewarc/internal/update"

// New returns the platform-independent unsupported adapter unless the binary
// is built for macOS with cgo and the explicit sparkle build tag.
func New(string) update.Adapter {
	return update.UnsupportedAdapter{}
}
