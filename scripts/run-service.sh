#!/bin/sh
set -eu
export CONTROL_DATABASE_URL="postgresql://verdant_control:$(cat /run/secrets/control_password)@control:5432/verdant"
export PRIMARY_DATABASE_URL="postgresql://verdant_monitor:$(cat /run/secrets/monitor_password)@primary:5432/workload"
export STANDBY_DATABASE_URL="postgresql://verdant_monitor:$(cat /run/secrets/monitor_password)@standby:5432/workload"
export PRIMARY_ACTION_URL="postgresql://verdant_executor:$(cat /run/secrets/executor_password)@primary:5432/workload"
export STANDBY_ACTION_URL="postgresql://verdant_executor:$(cat /run/secrets/executor_password)@standby:5432/workload"
export PRIMARY_DEMO_URL="postgresql://verdant_demo:$(cat /run/secrets/demo_password)@primary:5432/workload"
export STANDBY_DEMO_URL="postgresql://verdant_demo:$(cat /run/secrets/demo_password)@standby:5432/workload"
exec node "$@"
