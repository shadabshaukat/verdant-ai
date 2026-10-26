#!/bin/sh
set -eu
control_password="$(cat /run/secrets/control_password)"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=control_password="$control_password" <<'SQL'
SELECT format('CREATE ROLE verdant_control LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'control_password') \gexec
GRANT CONNECT, CREATE ON DATABASE verdant TO verdant_control;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
SQL
unset control_password
# The control schema is owned by the non-superuser application role.
for schema_file in /control-schema/*.sql; do
  [ -f "$schema_file" ] || continue
  (printf 'SET ROLE verdant_control;\n'; cat "$schema_file") | psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"
done
