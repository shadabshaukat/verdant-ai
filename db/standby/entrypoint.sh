#!/bin/sh
set -eu
export PGDATA="${PGDATA:-/var/lib/postgresql/18/docker}"
mkdir -p "$PGDATA"
chown postgres:postgres /var/lib/postgresql "$PGDATA"
chmod 0700 "$PGDATA"
replicator_password="$(cat /run/secrets/replicator_password)"
printf 'primary:5432:*:verdant_replicator:%s\n' "$replicator_password" > /var/lib/postgresql/.pgpass
chown postgres:postgres /var/lib/postgresql/.pgpass
chmod 0600 /var/lib/postgresql/.pgpass
unset replicator_password
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  # This named volume belongs only to this disposable standby.
  find "$PGDATA" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  gosu postgres pg_basebackup --host=primary --port=5432 --username=verdant_replicator \
    --pgdata="$PGDATA" --wal-method=stream --checkpoint=fast --progress --write-recovery-conf
fi
# Rebuild the connection string with a secret file reference, never a password literal.
cat > "$PGDATA/postgresql.auto.conf" <<'CONF'
primary_conninfo = 'host=primary port=5432 user=verdant_replicator application_name=verdant_standby passfile=/var/lib/postgresql/.pgpass'
CONF
chown postgres:postgres "$PGDATA/postgresql.auto.conf"
chmod 0600 "$PGDATA/postgresql.auto.conf"
exec gosu postgres postgres -D "$PGDATA" -c hot_standby=on -c shared_preload_libraries=pg_stat_statements -c compute_query_id=on
