#!/usr/bin/env bash
set -euo pipefail

destination="${1:?destination directory required}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../build/darwin/updater/sparkle.env
source "$script_dir/../../build/darwin/updater/sparkle.env"
archive="$(mktemp "${TMPDIR:-/tmp}/$SPARKLE_ARCHIVE.XXXXXX")"
trap 'rm -f "$archive"' EXIT

curl --fail --silent --show-error --location "$SPARKLE_URL" --output "$archive"
actual_sha256="$(shasum -a 256 "$archive" | awk '{print $1}')"
if [[ "$actual_sha256" != "$SPARKLE_SHA256" ]]; then
  echo "Sparkle archive checksum mismatch" >&2
  exit 1
fi

mkdir -p "$destination"
tar -xJf "$archive" -C "$destination"
[[ -d "$destination/Sparkle.framework" ]] || { echo "Sparkle.framework missing from archive" >&2; exit 1; }
[[ -x "$destination/bin/sign_update" ]] || { echo "sign_update missing from archive" >&2; exit 1; }
