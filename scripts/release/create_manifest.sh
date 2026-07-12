#!/usr/bin/env bash
set -euo pipefail

dmg="${1:?DMG path required}"
app="${2:?app bundle required}"
release_version="${3:?release version required}"
marketing_version="${4:?marketing version required}"
build_number="${5:?build number required}"
submission_id="${6:?notarization submission ID required}"
team_id="${7:?Apple Team ID required}"
plist="$app/Contents/Info.plist"
sha256="$(shasum -a 256 "$dmg" | awk '{print $1}')"
size="$(stat -f '%z' "$dmg")"
bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")"
minimum_macos="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$plist")"
channel=stable
[[ "$release_version" == *-* ]] && channel=beta

jq -n \
  --arg version "$release_version" \
  --arg marketingVersion "$marketing_version" \
  --arg buildNumber "$build_number" \
  --arg channel "$channel" \
  --arg publishedAt "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --arg sha256 "$sha256" \
  --argjson size "$size" \
  --arg notarizationSubmissionId "$submission_id" \
  --arg fileName "$(basename "$dmg")" \
  --arg gitTag "$GITHUB_REF_NAME" \
  --arg gitCommit "$GITHUB_SHA" \
  --arg bundleId "$bundle_id" \
  --arg minimumMacOS "$minimum_macos" \
  --arg teamId "$team_id" \
  '{
    schemaVersion: 1,
    product: "ReviewArc",
    channel: $channel,
    version: $version,
    marketingVersion: $marketingVersion,
    buildNumber: $buildNumber,
    publishedAt: $publishedAt,
    git: {tag: $gitTag, commit: $gitCommit},
    macOS: {
      minimumVersion: $minimumMacOS,
      architectures: ["arm64", "x86_64"],
      bundleId: $bundleId,
      signingTeamId: $teamId,
      fileName: $fileName,
      sizeBytes: $size,
      sha256: $sha256,
      downloadUrl: null,
      notarization: {status: "accepted", submissionId: $notarizationSubmissionId},
      ticketStapled: true
    },
    releaseNotesUrl: ("https://github.com/strantalis/reviewarc/releases/tag/" + $gitTag)
  }' > dist/release.json
