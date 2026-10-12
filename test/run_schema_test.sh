#!/bin/bash
# Needs a local Postgres (see test/README). Applies schema.sql to a scratch database and runs the checks.
export PGHOST=${PGHOST:-/var/tmp/duck-pg} PGPORT=${PGPORT:-54329} PGUSER=${PGUSER:-postgres}
cd "$(dirname "$0")/.."
psql -q -d postgres -c "drop database if exists duck" -c "create database duck" 2>&1 | grep -v NOTICE
psql -q -v ON_ERROR_STOP=1 -d duck -f test/pg_stub.sql 2>&1 | grep -v NOTICE
psql -q -v ON_ERROR_STOP=1 -d duck -f supabase/schema.sql 2>&1 | grep -v NOTICE
psql -v ON_ERROR_STOP=1 -d duck -f test/schema_test.sql 2>&1 | grep -v "^$" | sed 's/^psql:test\/schema_test.sql:[0-9]*: //' | grep -v "^CREATE FUNCTION\|^INSERT\|^SET\|^RESET\|^UPDATE\|^DELETE\|^ set_config\|^---\|^ *$\|row)\|^(1"
