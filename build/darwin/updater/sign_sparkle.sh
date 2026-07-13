#!/usr/bin/env bash
set -euo pipefail

app="${1:?app bundle required}"
identity="${2:?code signing identity required}"
framework="$app/Contents/Frameworks/Sparkle.framework"
version="$framework/Versions/B"

[[ -d "$framework" ]] || {
  echo "Sparkle.framework is not embedded in $app" >&2
  exit 1
}

sign_runtime() {
  codesign --force --sign "$identity" --options runtime --timestamp "$1"
}

# Sparkle contains nested executables and services. Sign every leaf before its
# containing bundle; using --deep for signing can apply incorrect entitlements
# to nested code and is explicitly unsupported by Sparkle.
sign_runtime "$version/XPCServices/Installer.xpc"
codesign --force --sign "$identity" --options runtime --timestamp \
  --preserve-metadata=entitlements "$version/XPCServices/Downloader.xpc"
sign_runtime "$version/Autoupdate"
sign_runtime "$version/Updater.app"
sign_runtime "$framework"

codesign --verify --strict --verbose=2 "$version/XPCServices/Installer.xpc"
codesign --verify --strict --verbose=2 "$version/XPCServices/Downloader.xpc"
codesign --verify --strict --verbose=2 "$version/Updater.app"
codesign --verify --strict --verbose=2 "$framework"
