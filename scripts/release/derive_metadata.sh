#!/usr/bin/env bash
set -euo pipefail

tag="${1:?release tag required}"
run_number="${2:?GitHub run number required}"
release_version="${tag#v}"
marketing_version="${release_version%%-*}"
channel=stable
[[ "$release_version" == *-* ]] && channel=beta

if [[ ! "$marketing_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid marketing version: $marketing_version" >&2
  exit 1
fi
if [[ ! "$run_number" =~ ^[1-9][0-9]*$ ]]; then
  echo "Invalid build number: $run_number" >&2
  exit 1
fi

{
  echo "release_version=$release_version"
  echo "marketing_version=$marketing_version"
  echo "build_number=$run_number"
  echo "channel=$channel"
} >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
