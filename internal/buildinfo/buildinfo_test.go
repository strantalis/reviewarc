package buildinfo

import "testing"

func TestDevelopmentDefaultsAreNotReleaseVersions(t *testing.T) {
	if Version != "0.0.0-dev" || BuildNumber != "0" || Channel != "stable" {
		t.Fatalf("unexpected development build metadata: %q %q %q", Version, BuildNumber, Channel)
	}
}
