#!/usr/bin/env bash
set -euo pipefail

app="${1:?app bundle required}"
framework="$app/Contents/Frameworks/Sparkle.framework"
plist="$app/Contents/Info.plist"
executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")"
binary="$app/Contents/MacOS/$executable"

[[ -d "$framework" ]] || {
  echo "Sparkle.framework is not embedded in $app" >&2
  exit 1
}

otool -L "$binary" | grep -F '@rpath/Sparkle.framework/Versions/B/Sparkle' >/dev/null || {
  echo "Application executable is not linked to the embedded Sparkle framework" >&2
  exit 1
}

otool -l "$binary" | grep -A3 LC_RPATH | grep -E '@executable_path/\.\./Frameworks|@loader_path/\.\./Frameworks' >/dev/null || {
  echo "Application executable has no runtime search path for Contents/Frameworks" >&2
  exit 1
}

codesign --verify --strict --verbose=2 "$framework"
codesign --verify --deep --strict --verbose=2 "$app"
