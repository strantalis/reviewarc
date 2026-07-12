#!/usr/bin/env bash
set -euo pipefail

manifest="${1:?manifest path required}"
cp "$manifest" site/release.json
npx --yes vercel@54.15.1 pull --yes --environment=production --cwd site --token "$VERCEL_TOKEN"
npx --yes vercel@54.15.1 deploy --prod --yes --cwd site --token "$VERCEL_TOKEN"
