#!/bin/sh
# Legacy optional shell entrypoint; maintained setup is portable Node.
set -eu
exec node "$(dirname "$0")/verdant.mjs" setup "$@"
