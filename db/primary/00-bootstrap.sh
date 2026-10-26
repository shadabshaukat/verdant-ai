#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\set monitor_password `cat /run/verdant-postgres/monitor_password`
\set executor_password `cat /run/verdant-postgres/executor_password`
\set demo_password `cat /run/verdant-postgres/demo_password`
\set replicator_password `cat /run/verdant-postgres/replicator_password`
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
