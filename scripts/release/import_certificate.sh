#!/usr/bin/env bash
set -euo pipefail

signing_dir="${RUNNER_TEMP:?}/reviewarc-signing"
keychain="$signing_dir/reviewarc.keychain-db"
certificate="$signing_dir/developer-id.p12"
keychain_password="$(openssl rand -hex 32)"
mkdir -p "$signing_dir"
chmod 700 "$signing_dir"

printf '%s' "$APPLE_DEVELOPER_ID_P12_BASE64" | base64 --decode > "$certificate"
chmod 600 "$certificate"

security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$certificate" -k "$keychain" \
  -P "$APPLE_DEVELOPER_ID_P12_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple: -s \
  -k "$keychain_password" "$keychain"
security list-keychains -d user -s "$keychain"
security default-keychain -d user -s "$keychain"

if ! security find-identity -v -p codesigning "$keychain" | grep -Fq "$APPLE_SIGNING_IDENTITY"; then
  echo "::error::APPLE_SIGNING_IDENTITY was not found in the imported certificate."
  exit 1
fi
