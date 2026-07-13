#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/reviewarc-release-test.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

template_plist="$script_dir/../../build/darwin/Info.plist"
grep -Fq '<string>com.silkcitylabs.reviewarc</string>' "$template_plist"

GITHUB_OUTPUT="$tmp/metadata.out" "$script_dir/derive_metadata.sh" v0.3.0-beta.2 57
grep -qx 'release_version=0.3.0-beta.2' "$tmp/metadata.out"
grep -qx 'marketing_version=0.3.0' "$tmp/metadata.out"
grep -qx 'build_number=57' "$tmp/metadata.out"
grep -qx 'channel=beta' "$tmp/metadata.out"
if GITHUB_OUTPUT="$tmp/invalid.out" "$script_dir/derive_metadata.sh" unsafe-tag 1 2>/dev/null; then
  echo "derive_metadata accepted an unsafe tag" >&2
  exit 1
fi

mkdir -p "$tmp/sparkle/bin"
cat > "$tmp/sparkle/bin/sign_update" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "--verify" ]]; then
  [[ "${@: -1}" == AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA== ]]
  exit 0
fi
printf '%s\n' AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==
EOF
chmod +x "$tmp/sparkle/bin/sign_update"
printf 'notarized-dmg-fixture' > "$tmp/signed-fixture.dmg"
printf '%s\n' AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= > "$tmp/fixture-private-key"
sparkle_key="$(base64 -i "$tmp/fixture-private-key")"
sparkle_public_key="$(CLANG_MODULE_CACHE_PATH="$tmp/swift-module-cache" swift "$script_dir/derive_sparkle_public_key.swift" "$tmp/fixture-private-key")"
RUNNER_TEMP="$tmp" GITHUB_OUTPUT="$tmp/sparkle.out" SPARKLE_ED25519_PRIVATE_KEY_BASE64="$sparkle_key" SPARKLE_PUBLIC_ED_KEY="$sparkle_public_key" \
  "$script_dir/sign_sparkle_update.sh" "$tmp/signed-fixture.dmg" "$tmp/sparkle"
grep -qx 'ed_signature=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==' "$tmp/sparkle.out"

app="$tmp/ReviewArc.app"
plist="$app/Contents/Info.plist"
mkdir -p "$app/Contents"
plutil -create xml1 "$plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleIdentifier string com.wails.ReviewArc' "$plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleShortVersionString string 1.0.0' "$plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleVersion string 1' "$plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleGetInfoString string ReviewArc' "$plist"
/usr/libexec/PlistBuddy -c 'Add :NSHumanReadableCopyright string placeholder' "$plist"
/usr/libexec/PlistBuddy -c 'Add :LSMinimumSystemVersion string 10.13.0' "$plist"
"$script_dir/prepare_app.sh" "$app" com.example.reviewarc 0.3.0 57 'Copyright 2026 Example LLC' \
  AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= https://www.reviewarc.dev/api/appcast.xml
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")" == com.example.reviewarc ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$plist")" == 57 ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :SUPublicEDKey' "$plist")" == AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :SUFeedURL' "$plist")" == https://www.reviewarc.dev/api/appcast.xml ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :SUEnableAutomaticChecks' "$plist")" == false ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :SUAllowsAutomaticUpdates' "$plist")" == true ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :SUAutomaticallyUpdate' "$plist")" == true ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :SUVerifyUpdateBeforeExtraction' "$plist")" == true ]]

printf 'notarized-dmg-fixture' > "$tmp/ReviewArc-0.3.0-beta.2-macOS-universal.dmg"
(
  cd "$tmp"
  mkdir dist
  GITHUB_REF_NAME=v0.3.0-beta.2 GITHUB_SHA=0123456789abcdef0123456789abcdef01234567 \
    "$script_dir/create_manifest.sh" \
    "$tmp/ReviewArc-0.3.0-beta.2-macOS-universal.dmg" "$app" \
    0.3.0-beta.2 0.3.0 57 11111111-2222-3333-4444-555555555555 ABCDE12345 \
    AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==
  jq -e '
    .schemaVersion == 1 and
    .channel == "beta" and
    .version == "0.3.0-beta.2" and
    .macOS.bundleId == "com.example.reviewarc" and
    .macOS.signingTeamId == "ABCDE12345" and
    .macOS.sparkle.edSignature == "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==" and
    .macOS.sparkle.contentType == "application/x-apple-diskimage" and
    (.macOS.sha256 | test("^[a-f0-9]{64}$")) and
    .macOS.downloadUrl == null
  ' dist/release.json >/dev/null
)

node "$script_dir/test_channel_policy.mjs"
echo "release script tests passed"
