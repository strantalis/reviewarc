#!/usr/bin/env bash
set -euo pipefail

dmg="${1:?DMG path required}"
mkdir -p dist
key_file="${RUNNER_TEMP:?}/reviewarc-signing/AuthKey_${APPLE_NOTARY_KEY_ID}.p8"
printf '%s' "$APPLE_NOTARY_KEY_P8_BASE64" | base64 --decode > "$key_file"
chmod 600 "$key_file"

if ! xcrun notarytool submit "$dmg" \
  --key "$key_file" \
  --key-id "$APPLE_NOTARY_KEY_ID" \
  --issuer "$APPLE_NOTARY_ISSUER_ID" \
  --wait --output-format json > dist/notary-result.json; then
  submission_id="$(jq -r '.id // empty' dist/notary-result.json 2>/dev/null || true)"
  if [[ -n "$submission_id" ]]; then
    xcrun notarytool log "$submission_id" \
      --key "$key_file" --key-id "$APPLE_NOTARY_KEY_ID" \
      --issuer "$APPLE_NOTARY_ISSUER_ID" || true
  fi
  exit 1
fi

status="$(jq -r '.status' dist/notary-result.json)"
submission_id="$(jq -r '.id' dist/notary-result.json)"
[[ "$status" == "Accepted" && -n "$submission_id" && "$submission_id" != "null" ]] || {
  echo "::error::Apple notarization status was $status."
  exit 1
}

xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg"
codesign --verify --strict --verbose=2 "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"

mount_point="$(mktemp -d "${RUNNER_TEMP:?}/reviewarc-notarized.XXXXXX")"
cleanup_mount() {
  hdiutil detach "$mount_point" -quiet 2>/dev/null || true
  rmdir "$mount_point" 2>/dev/null || true
}
trap cleanup_mount EXIT
hdiutil attach "$dmg" -readonly -nobrowse -noautoopen -mountpoint "$mount_point"
spctl --assess --type execute --verbose=2 "$mount_point/ReviewArc.app"
cleanup_mount
trap - EXIT

shasum -a 256 "$dmg" > "$dmg.sha256"
echo "submission_id=$submission_id" >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
