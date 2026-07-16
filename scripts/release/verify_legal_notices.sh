#!/usr/bin/env bash
set -euo pipefail

app="${1:?app bundle required}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$script_dir/../.." && pwd)"
source_notice="$repository_root/THIRD_PARTY_NOTICES.txt"
bundled_notice="$app/Contents/Resources/ThirdPartyNotices.txt"

[[ -s "$source_notice" ]] || { echo "Third-party notice source is missing or empty: $source_notice" >&2; exit 1; }
[[ -s "$bundled_notice" ]] || { echo "Third-party notices are not bundled in $app" >&2; exit 1; }
cmp -s "$source_notice" "$bundled_notice" || {
  echo "Bundled third-party notices are stale or altered: $bundled_notice" >&2
  exit 1
}

grep -Eq '^  - Sparkle 2\.9\.2$' "$bundled_notice" || { echo "Sparkle notice is missing" >&2; exit 1; }
grep -Eq '^  - Go runtime:' "$bundled_notice" || { echo "Go runtime notice is missing" >&2; exit 1; }
grep -Eq '^  - npm: react@' "$bundled_notice" || { echo "React notice is missing" >&2; exit 1; }
