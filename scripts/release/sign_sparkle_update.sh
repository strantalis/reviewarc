#!/usr/bin/env bash
set -euo pipefail

dmg="${1:?DMG path required}"
sparkle_dir="${2:?Sparkle distribution directory required}"
sign_update="$sparkle_dir/bin/sign_update"
signing_dir="${RUNNER_TEMP:?RUNNER_TEMP is required}/reviewarc-signing"
private_key="$signing_dir/sparkle-ed25519-private-key"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ -f "$dmg" ]] || { echo "DMG not found at $dmg" >&2; exit 1; }
[[ -x "$sign_update" ]] || { echo "Sparkle sign_update not found at $sign_update" >&2; exit 1; }
[[ -n "${SPARKLE_ED25519_PRIVATE_KEY_BASE64:-}" ]] || { echo "SPARKLE_ED25519_PRIVATE_KEY_BASE64 is required" >&2; exit 1; }
[[ -n "${SPARKLE_PUBLIC_ED_KEY:-}" ]] || { echo "SPARKLE_PUBLIC_ED_KEY is required" >&2; exit 1; }

mkdir -p "$signing_dir"
umask 077
printf '%s' "$SPARKLE_ED25519_PRIVATE_KEY_BASE64" | base64 -D > "$private_key"
[[ -s "$private_key" ]] || { echo "Sparkle private key decoded to an empty file" >&2; exit 1; }

derived_public_key="$(CLANG_MODULE_CACHE_PATH="$signing_dir/swift-module-cache" swift "$script_dir/derive_sparkle_public_key.swift" "$private_key")"
if [[ "$derived_public_key" != "$SPARKLE_PUBLIC_ED_KEY" ]]; then
  echo "Sparkle private key does not match SPARKLE_PUBLIC_ED_KEY" >&2
  exit 1
fi

signature="$($sign_update --ed-key-file "$private_key" -p "$dmg")"
signature_pattern='^[A-Za-z0-9+/]{86}==$'
if [[ ! "$signature" =~ $signature_pattern ]]; then
  echo "Sparkle sign_update returned an invalid Ed25519 signature" >&2
  exit 1
fi

"$sign_update" --verify --ed-key-file "$private_key" "$dmg" "$signature"
echo "ed_signature=$signature" >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
