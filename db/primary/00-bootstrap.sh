#!/bin/sh
set -eu
monitor_password="$(cat /run/secrets/monitor_password)"
executor_password="$(cat /run/secrets/executor_password)"
demo_password="$(cat /run/secrets/demo_password)"
replicator_password="$(cat /run/secrets/replicator_password)"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
 --set=monitor_password="$monitor_password" --set=executor_password="$executor_password" \
 --set=demo_password="$demo_password" --set=replicator_password="$replicator_password" <<'SQL'
SELECT format('CREATE ROLE verdant_monitor LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'monitor_password') \gexec
SELECT format('CREATE ROLE verdant_executor LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'executor_password') \gexec
SELECT format('CREATE ROLE verdant_demo LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'demo_password') \gexec
SELECT format('CREATE ROLE verdant_replicator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE REPLICATION NOBYPASSRLS PASSWORD %L', :'replicator_password') \gexec
CREATE ROLE verdant_risky_login LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT pg_monitor TO verdant_monitor;
ALTER ROLE verdant_monitor SET statement_timeout = '5s';
ALTER ROLE verdant_monitor SET default_transaction_read_only = on;
ALTER ROLE verdant_executor SET statement_timeout = '10s';
ALTER ROLE verdant_executor SET lock_timeout = '2s';
ALTER ROLE verdant_demo SET statement_timeout = '180s';
ALTER ROLE verdant_demo SET idle_in_transaction_session_timeout = '180s';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE workload TO verdant_monitor, verdant_executor, verdant_demo;
SQL
printf '\nhost replication verdant_replicator all scram-sha-256\n' >> "$PGDATA/pg_hba.conf"
unset monitor_password executor_password demo_password replicator_password
