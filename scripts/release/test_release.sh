#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/reviewarc-release-test.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

template_plist="$script_dir/../../build/darwin/Info.plist"
grep -Fq '<string>com.silkcitylabs.reviewarc</string>' "$template_plist"

GITHUB_OUTPUT="$tmp/metadata.out" "$script_dir/derive_metadata.sh" v0.3.0-beta.2 57
grep -qx 'release_version=0.3.0-beta.2' "$tmp/metadata.out"
grep -qx 'marketing_version=0.3.0' "$tmp/metadata.out"
grep -qx 'build_number=57' "$tmp/metadata.out"
if GITHUB_OUTPUT="$tmp/invalid.out" "$script_dir/derive_metadata.sh" unsafe-tag 1 2>/dev/null; then
  echo "derive_metadata accepted an unsafe tag" >&2
  exit 1
fi

app="$tmp/ReviewArc.app"
plist="$app/Contents/Info.plist"
mkdir -p "$app/Contents"
plutil -create xml1 "$plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleIdentifier string com.wails.ReviewArc' "$plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleShortVersionString string 1.0.0' "$plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleVersion string 1' "$plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleGetInfoString string ReviewArc' "$plist"
/usr/libexec/PlistBuddy -c 'Add :NSHumanReadableCopyright string placeholder' "$plist"
/usr/libexec/PlistBuddy -c 'Add :LSMinimumSystemVersion string 10.13.0' "$plist"
"$script_dir/prepare_app.sh" "$app" com.example.reviewarc 0.3.0 57 'Copyright 2026 Example LLC'
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")" == com.example.reviewarc ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$plist")" == 57 ]]

printf 'notarized-dmg-fixture' > "$tmp/ReviewArc-0.3.0-beta.2-macOS-universal.dmg"
(
  cd "$tmp"
  mkdir dist
  GITHUB_REF_NAME=v0.3.0-beta.2 GITHUB_SHA=0123456789abcdef0123456789abcdef01234567 \
    "$script_dir/create_manifest.sh" \
    "$tmp/ReviewArc-0.3.0-beta.2-macOS-universal.dmg" "$app" \
    0.3.0-beta.2 0.3.0 57 11111111-2222-3333-4444-555555555555 ABCDE12345
  jq -e '
    .schemaVersion == 1 and
    .channel == "beta" and
    .version == "0.3.0-beta.2" and
    .macOS.bundleId == "com.example.reviewarc" and
    .macOS.signingTeamId == "ABCDE12345" and
    (.macOS.sha256 | test("^[a-f0-9]{64}$")) and
    .macOS.downloadUrl == null
  ' dist/release.json >/dev/null
)

echo "release script tests passed"
