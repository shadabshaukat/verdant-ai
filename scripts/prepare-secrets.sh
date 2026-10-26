#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077
mkdir -p .secrets
for secret_name in postgres_password control_password monitor_password executor_password demo_password replicator_password; do
  if [ ! -s ".secrets/$secret_name" ]; then
    openssl rand -hex 24 > ".secrets/$secret_name"
    printf 'Prepared %s\n' "$secret_name"
  fi
done
