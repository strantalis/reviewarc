#!/usr/bin/env bash
set -euo pipefail

app="${1:?app bundle required}"
dmg="${2:?DMG path required}"
staging="$(mktemp -d "${TMPDIR:-/tmp}/reviewarc-dmg.XXXXXX")"
mounted=""
cleanup() {
  if [[ -n "$mounted" ]]; then hdiutil detach "$mounted" -quiet || true; fi
  rm -rf "$staging"
}
trap cleanup EXIT

mkdir -p "$(dirname "$dmg")"
ditto "$app" "$staging/ReviewArc.app"
ln -s /Applications "$staging/Applications"
hdiutil create -volname ReviewArc -srcfolder "$staging" \
  -fs HFS+ -format UDZO -imagekey zlib-level=9 -ov "$dmg"
hdiutil verify "$dmg"

mounted="$(hdiutil attach "$dmg" -readonly -nobrowse -noautoopen | awk '/Apple_HFS|Apple_APFS/ {print $NF; exit}')"
[[ -n "$mounted" ]] || { echo "Unable to mount DMG for inspection" >&2; exit 1; }
inventory="$(find "$mounted" -mindepth 1 -maxdepth 1 -print | sed "s#^$mounted/##" | sort)"
[[ "$inventory" == $'Applications\nReviewArc.app' ]] || {
  echo "Unexpected DMG contents:" >&2
  printf '%s\n' "$inventory" >&2
  exit 1
}
