#!/usr/bin/env bash
set -euo pipefail

app="${1:?app bundle required}"
bundle_id="${2:?bundle identifier required}"
marketing_version="${3:?marketing version required}"
build_number="${4:?build number required}"
copyright="${5:?copyright required}"
sparkle_public_key="${6:?Sparkle public Ed25519 key required}"
sparkle_feed_url="${7:?Sparkle feed URL required}"
plist="$app/Contents/Info.plist"

[[ -f "$plist" ]] || { echo "Info.plist not found at $plist" >&2; exit 1; }
[[ "$bundle_id" =~ ^[A-Za-z0-9][A-Za-z0-9.-]+$ ]] || { echo "Invalid bundle identifier" >&2; exit 1; }
[[ "$marketing_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Invalid marketing version" >&2; exit 1; }
[[ "$build_number" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid build number" >&2; exit 1; }
sparkle_public_key_pattern='^[A-Za-z0-9+/]{43}=$'
[[ "$sparkle_public_key" =~ $sparkle_public_key_pattern ]] || { echo "Invalid Sparkle public Ed25519 key" >&2; exit 1; }
[[ "$sparkle_feed_url" == "https://www.reviewarc.dev/api/appcast.xml" ]] || { echo "Invalid Sparkle feed URL" >&2; exit 1; }

set_plist_value() {
  local key="$1"
  local type="$2"
  local value="$3"
  if /usr/libexec/PlistBuddy -c "Print :$key" "$plist" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Set :$key $value" "$plist"
  else
    /usr/libexec/PlistBuddy -c "Add :$key $type $value" "$plist"
  fi
}

/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $bundle_id" "$plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $marketing_version" "$plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $build_number" "$plist"
/usr/libexec/PlistBuddy -c "Set :NSHumanReadableCopyright $copyright" "$plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleGetInfoString ReviewArc $marketing_version" "$plist"
set_plist_value SUPublicEDKey string "$sparkle_public_key"
set_plist_value SUFeedURL string "$sparkle_feed_url"
set_plist_value SUEnableAutomaticChecks bool false
set_plist_value SUAllowsAutomaticUpdates bool false
set_plist_value SUAutomaticallyUpdate bool false
set_plist_value SUVerifyUpdateBeforeExtraction bool true
