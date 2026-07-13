#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=sparkle.env
source "$script_dir/sparkle.env"

deps_dir="$script_dir/.deps"
archive="$deps_dir/$SPARKLE_ARCHIVE"
framework="$deps_dir/Sparkle.framework"

mkdir -p "$deps_dir"

if [[ ! -f "$archive" ]]; then
  curl --fail --location --retry 3 --output "$archive" "$SPARKLE_URL"
fi

actual_sha256="$(shasum -a 256 "$archive" | awk '{print $1}')"
if [[ "$actual_sha256" != "$SPARKLE_SHA256" ]]; then
  echo "Sparkle archive checksum mismatch: expected $SPARKLE_SHA256, got $actual_sha256" >&2
  exit 1
fi

if [[ ! -d "$framework" ]]; then
  tar -xJf "$archive" -C "$deps_dir" ./Sparkle.framework ./bin/sign_update ./LICENSE
fi

[[ -x "$framework/Versions/B/Sparkle" ]] || {
  echo "Sparkle framework is incomplete at $framework" >&2
  exit 1
}

echo "$framework"
