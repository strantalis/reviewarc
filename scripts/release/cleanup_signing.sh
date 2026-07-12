#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${RUNNER_TEMP:-}" ]]; then
  echo "RUNNER_TEMP is not set; refusing to remove signing material." >&2
  exit 1
fi

signing_dir="$RUNNER_TEMP/reviewarc-signing"
keychain="$signing_dir/reviewarc.keychain-db"
if [[ -f "$keychain" ]]; then
  security delete-keychain "$keychain" || true
fi
if [[ -n "${signing_dir:-}" && -d "$signing_dir" ]]; then
  rm -rf "$signing_dir"
fi
