#!/usr/bin/env bash
set -euo pipefail

dmg="${1:?DMG path required}"
sbom="${2:?SPDX JSON path required}"
assets=("$dmg" "$dmg.sha256" "$sbom" "$sbom.sha256")
if ! gh release view "$GITHUB_REF_NAME" >/dev/null 2>&1; then
  args=(release create "$GITHUB_REF_NAME" "${assets[@]}" \
    --verify-tag --generate-notes --title "ReviewArc ${GITHUB_REF_NAME#v}")
  if [[ "$GITHUB_REF_NAME" == *-* ]]; then
    args+=(--prerelease)
  fi
  gh "${args[@]}"
  exit 0
fi

download_dir="$(mktemp -d "${RUNNER_TEMP:?}/reviewarc-release-assets.XXXXXX")"
trap 'rm -rf "$download_dir"' EXIT
existing_assets="$(gh release view "$GITHUB_REF_NAME" --json assets --jq '.assets[].name')"
for asset in "${assets[@]}"; do
  name="$(basename "$asset")"
  if printf '%s\n' "$existing_assets" | grep -Fxq "$name"; then
    gh release download "$GITHUB_REF_NAME" --pattern "$name" --dir "$download_dir"
    if ! cmp -s "$asset" "$download_dir/$name"; then
      echo "Existing GitHub release asset $name does not match the local release." >&2
      exit 1
    fi
  else
    gh release upload "$GITHUB_REF_NAME" "$asset"
  fi
done
