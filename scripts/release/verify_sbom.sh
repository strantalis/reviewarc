#!/usr/bin/env bash
set -euo pipefail

sbom="${1:?SPDX JSON path required}"
dmg="${2:?DMG path required}"

[[ -f "$sbom" ]] || { echo "SBOM not found at $sbom" >&2; exit 1; }
[[ -f "$dmg" ]] || { echo "DMG not found at $dmg" >&2; exit 1; }

dmg_name="$(basename "$dmg")"
dmg_sha256="$(shasum -a 256 "$dmg" | awk '{print $1}')"

jq -e --arg dmg_name "$dmg_name" --arg dmg_sha256 "$dmg_sha256" '
  .spdxVersion == "SPDX-2.3" and
  .SPDXID == "SPDXRef-DOCUMENT" and
  (.creationInfo.creators | any(. == "Tool: ReviewArc release SBOM augmenter")) and
  ([.packages[] | select(
    .name == $dmg_name and
    (.checksums | any(.algorithm == "SHA256" and .checksumValue == $dmg_sha256))
  )] | length) == 1 and
  ([.packages[] | select(.name == "ReviewArc.app" and .licenseDeclared == "Apache-2.0")] | length) == 1 and
  ([.packages[] | select(.name == "Sparkle" and .licenseDeclared == "MIT")] | length) == 1 and
  ([.packages[].externalRefs[]? | select(.referenceLocator | startswith("pkg:npm/"))] | length) > 0 and
  ([.packages[].externalRefs[]? | select(.referenceLocator | startswith("pkg:golang/"))] | length) > 0 and
  ([.relationships[] | select(.spdxElementId == "SPDXRef-DOCUMENT" and .relationshipType == "DESCRIBES")] | length) == 1
' "$sbom" >/dev/null
