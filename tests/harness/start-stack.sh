#!/usr/bin/env bash
# Fresh database + local Supabase stand-in for end-to-end tests.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-54329}" PGUSER="${PGUSER:-postgres}" TEST_DB="${TEST_DB:-kirana_e2e}"
tests/harness/reset-db.sh
psql -q -d "$TEST_DB" -c "insert into public.platform_setup(id, code_hash, expires_at) values (1, encode(sha256('e2e-setup-code'::bytea), 'hex'), now() + interval '1 day')"
exec node tests/harness/local-supabase.mjs
