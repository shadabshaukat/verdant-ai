#!/bin/sh
# Official Postgres runs init scripts as postgres; file-backed Compose secrets may be owned by a different host UID.
set -eu
install -d -m 0700 -o postgres -g postgres /run/verdant-postgres
for name in monitor_password executor_password demo_password replicator_password; do
  install -m 0600 -o postgres -g postgres "/run/secrets/$name" "/run/verdant-postgres/$name"
done
exec /usr/local/bin/docker-entrypoint.sh "$@"
