#!/usr/bin/env bash
set -euo pipefail

app="${1:?app bundle required}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$script_dir/../../.." && pwd)"
source_framework="${2:-}"
if [[ -z "$source_framework" ]]; then
  if [[ -d "$repository_root/dist/sparkle/Sparkle.framework" ]]; then
    source_framework="$repository_root/dist/sparkle/Sparkle.framework"
  else
    source_framework="$($script_dir/fetch_sparkle.sh)"
  fi
fi
frameworks_dir="$app/Contents/Frameworks"
destination="$frameworks_dir/Sparkle.framework"
plist="$app/Contents/Info.plist"

[[ -d "$app/Contents" ]] || {
  echo "Invalid app bundle: $app" >&2
  exit 1
}

[[ -d "$source_framework" ]] || {
  echo "Sparkle framework not found at $source_framework" >&2
  exit 1
}

mkdir -p "$frameworks_dir"
ditto "$source_framework" "$destination"

executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")"
binary="$app/Contents/MacOS/$executable"
if ! otool -l "$binary" | grep -A3 LC_RPATH | grep -F '@executable_path/../Frameworks' >/dev/null; then
  install_name_tool -add_rpath '@executable_path/../Frameworks' "$binary"
fi

[[ -L "$destination/Sparkle" && -L "$destination/Versions/Current" ]] || {
  echo "Sparkle framework symlinks were not preserved" >&2
  exit 1
}

"$repository_root/scripts/release/bundle_legal_notices.sh" "$app" >/dev/null

echo "$destination"
