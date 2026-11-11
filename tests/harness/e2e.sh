#!/usr/bin/env bash
# Builds the app against the local stand-in and runs the browser tests.
set -euo pipefail
cd "$(dirname "$0")/../.."
KEYS=$(node tests/harness/local-supabase.mjs keys)
export NEXT_PUBLIC_SUPABASE_URL=$(node -e "console.log(JSON.parse(process.argv[1]).url)" "$KEYS")
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$(node -e "console.log(JSON.parse(process.argv[1]).anon)" "$KEYS")
npm run build
npx playwright test "$@"
