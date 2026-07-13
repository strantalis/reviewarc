// Package buildinfo exposes release metadata injected by the release build.
// Development builds intentionally use explicit, non-release defaults.
package buildinfo

var (
	Version     = "0.0.0-dev"
	BuildNumber = "0"
	Channel     = "stable"
)
