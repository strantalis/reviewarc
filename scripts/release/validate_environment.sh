#!/usr/bin/env bash
set -euo pipefail

scope="${1:?validation scope must be apple, publish, or channel}"
case "$scope" in
  apple)
    required=(
      APPLE_BUNDLE_ID
      APPLE_COPYRIGHT
      APPLE_SIGNING_IDENTITY
      APPLE_TEAM_ID
      SPARKLE_FEED_URL
      SPARKLE_PUBLIC_ED_KEY
    )
    ;;
  publish|channel)
    required=(
      BLOB_READ_WRITE_TOKEN
    )
    ;;
  *)
    echo "Validation scope must be apple, publish, or channel." >&2
    exit 1
    ;;
esac

for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "::error::Required release configuration $name is not set."
    exit 1
  fi
done

if [[ "$scope" == apple ]]; then
  if [[ ! "$APPLE_BUNDLE_ID" =~ ^[A-Za-z0-9][A-Za-z0-9.-]+$ ]]; then
    echo "::error::APPLE_BUNDLE_ID is not a valid reverse-DNS bundle identifier."
    exit 1
  fi
  if [[ ! "$APPLE_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]]; then
    echo "::error::APPLE_TEAM_ID must be the 10-character Apple Developer Team ID."
    exit 1
  fi
  sparkle_public_key_pattern='^[A-Za-z0-9+/]{43}=$'
  if [[ ! "$SPARKLE_PUBLIC_ED_KEY" =~ $sparkle_public_key_pattern ]]; then
    echo "::error::SPARKLE_PUBLIC_ED_KEY must be a base64-encoded Ed25519 public key."
    exit 1
  fi
  if [[ "$SPARKLE_FEED_URL" != "https://www.reviewarc.dev/api/appcast.xml" ]]; then
    echo "::error::SPARKLE_FEED_URL must be https://www.reviewarc.dev/api/appcast.xml."
    exit 1
  fi
fi

if [[ "$scope" == channel ]]; then
  exit 0
fi

if [[ ! "$GITHUB_REF_NAME" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-([0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*))?$ ]]; then
  echo "::error::Release tags must look like v0.1.0 or v0.1.0-beta.1."
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
allowed_signers="$repo_root/.github/release-allowed-signers"
if [[ ! -s "$allowed_signers" ]]; then
  echo "::error::Trusted release signer configuration is missing."
  exit 1
fi
if ! git -c gpg.ssh.allowedSignersFile="$allowed_signers" verify-tag "$GITHUB_REF_NAME"; then
  echo "::error::Release tags must be signed by a trusted ReviewArc release key."
  exit 1
fi
tagged_commit="$(git rev-parse "$GITHUB_REF_NAME^{commit}")"
if [[ "$tagged_commit" != "$GITHUB_SHA" ]]; then
  echo "::error::Release tag does not resolve to the workflow commit."
  exit 1
fi

prerelease="${GITHUB_REF_NAME#*-}"
if [[ "$prerelease" != "$GITHUB_REF_NAME" ]]; then
  IFS='.' read -r -a identifiers <<< "$prerelease"
  for identifier in "${identifiers[@]}"; do
    if [[ "$identifier" =~ ^[0-9]+$ && "$identifier" != "0" && "$identifier" == 0* ]]; then
      echo "::error::Numeric prerelease identifiers cannot contain leading zeroes."
      exit 1
    fi
  done
fi

git fetch --no-tags origin main
if ! git merge-base --is-ancestor "$GITHUB_SHA" origin/main; then
  echo "::error::Release tags must point to a commit on origin/main."
  exit 1
fi
