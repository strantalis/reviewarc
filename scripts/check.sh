#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

npm --prefix frontend run check
npm --prefix site run check
npm --prefix site run build

unformatted="$(git ls-files '*.go' | xargs gofmt -l)"
if [[ -n "$unformatted" ]]; then
  printf '%s\n' "$unformatted"
  exit 1
fi

go vet ./...
golangci-lint run ./...
go test ./...
scripts/release/test_release.sh
node scripts/release/test_semver.mjs
build/darwin/updater/fetch_sparkle.sh
node scripts/release/generate_third_party_notices.mjs --check
go run github.com/wailsapp/wails/v2/cmd/wails@v2.13.0 build
npm --prefix frontend run normalize:bindings
git diff --check
