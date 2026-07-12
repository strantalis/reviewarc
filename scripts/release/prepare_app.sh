#!/usr/bin/env bash
set -euo pipefail

app="${1:?app bundle required}"
bundle_id="${2:?bundle identifier required}"
marketing_version="${3:?marketing version required}"
build_number="${4:?build number required}"
copyright="${5:?copyright required}"
plist="$app/Contents/Info.plist"

[[ -f "$plist" ]] || { echo "Info.plist not found at $plist" >&2; exit 1; }
[[ "$bundle_id" =~ ^[A-Za-z0-9][A-Za-z0-9.-]+$ ]] || { echo "Invalid bundle identifier" >&2; exit 1; }
[[ "$marketing_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Invalid marketing version" >&2; exit 1; }
[[ "$build_number" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid build number" >&2; exit 1; }

/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $bundle_id" "$plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $marketing_version" "$plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $build_number" "$plist"
/usr/libexec/PlistBuddy -c "Set :NSHumanReadableCopyright $copyright" "$plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleGetInfoString ReviewArc $marketing_version" "$plist"
