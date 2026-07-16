#!/usr/bin/env bash
set -euo pipefail

app="${1:?app bundle required}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$script_dir/../.." && pwd)"
source_notice="$repository_root/THIRD_PARTY_NOTICES.txt"
resources="$app/Contents/Resources"
destination="$resources/ThirdPartyNotices.txt"

[[ -d "$app/Contents" ]] || { echo "Invalid app bundle: $app" >&2; exit 1; }
[[ -s "$source_notice" ]] || { echo "Third-party notice source is missing or empty: $source_notice" >&2; exit 1; }
node "$script_dir/generate_third_party_notices.mjs" --check

mkdir -p "$resources"
install -m 0644 "$source_notice" "$destination"
cmp -s "$source_notice" "$destination" || {
  echo "Bundled third-party notices do not match $source_notice" >&2
  exit 1
}

echo "$destination"
