#!/usr/bin/env bash
set -euo pipefail

scope="${1:?validation scope must be apple or publish}"
case "$scope" in
  apple)
    required=(
      APPLE_BUNDLE_ID
      APPLE_COPYRIGHT
      APPLE_SIGNING_IDENTITY
      APPLE_TEAM_ID
      APPLE_DEVELOPER_ID_P12_BASE64
      APPLE_DEVELOPER_ID_P12_PASSWORD
      APPLE_NOTARY_KEY_P8_BASE64
      APPLE_NOTARY_KEY_ID
      APPLE_NOTARY_ISSUER_ID
    )
    ;;
  publish)
    required=(
      BLOB_READ_WRITE_TOKEN
    )
    ;;
  *)
    echo "Validation scope must be apple or publish." >&2
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
fi

if [[ ! "$GITHUB_REF_NAME" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-([0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*))?$ ]]; then
  echo "::error::Release tags must look like v0.1.0 or v0.1.0-beta.1."
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
