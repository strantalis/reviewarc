#!/usr/bin/env bash
set -euo pipefail

app="${1:?app bundle required}"
expected_bundle_id="${2:?bundle identifier required}"
expected_team_id="${3:?Apple Team ID required}"
plist="$app/Contents/Info.plist"
executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")"
actual_bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")"

[[ "$actual_bundle_id" == "$expected_bundle_id" ]] || {
  echo "Bundle identifier mismatch: $actual_bundle_id" >&2
  exit 1
}

codesign --verify --deep --strict --verbose=2 "$app"
codesign --display --verbose=4 "$app"
actual_team_id="$(codesign --display --verbose=4 "$app" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
[[ "$actual_team_id" == "$expected_team_id" ]] || {
  echo "::error::Expected Apple Team ID $expected_team_id, found $actual_team_id."
  exit 1
}

if codesign --display --entitlements :- "$app" 2>/dev/null | grep -q 'com.apple.security.get-task-allow'; then
  echo "::error::Release app contains the development-only get-task-allow entitlement."
  exit 1
fi

architectures="$(lipo -archs "$app/Contents/MacOS/$executable")"
[[ "$architectures" == *arm64* && "$architectures" == *x86_64* ]] || {
  echo "::error::Expected arm64 and x86_64, found: $architectures"
  exit 1
}
