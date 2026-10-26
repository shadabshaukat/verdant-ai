#!/bin/sh
set -eu
export PGPASSWORD="$(cat /run/secrets/postgres_password)"
export PGHOST=control PGUSER=postgres PGDATABASE=verdant
psql -X -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public'
for schema_file in /control-schema/*.sql; do
  [ -f "$schema_file" ] || continue
  # Application objects remain owned by the non-superuser control role.
  (printf 'BEGIN;\nSET LOCAL ROLE verdant_control;\n'; cat "$schema_file"; printf '\nCOMMIT;\n') |
    psql -X -v ON_ERROR_STOP=1
done
unset PGPASSWORD
