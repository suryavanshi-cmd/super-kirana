#!/usr/bin/env bash
# Recreates a local test database and applies the shim + all migrations.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${PGHOST:=127.0.0.1}" "${PGPORT:=54329}" "${PGUSER:=postgres}" "${TEST_DB:=kirana_test}"
export PGHOST PGPORT PGUSER
psql -q -d postgres -c "drop database if exists ${TEST_DB} with (force)" -c "create database ${TEST_DB}"
psql -q -v ON_ERROR_STOP=1 -d "${TEST_DB}" -f tests/harness/supabase_shim.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "${TEST_DB}" -f "$f"; done
psql -q -d "${TEST_DB}" -c "grant all on all tables in schema public to service_role"
echo "database ${TEST_DB} ready"
