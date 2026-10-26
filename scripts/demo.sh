#!/bin/sh
# Compatibility wrapper. PowerShell users run node scripts/verdant.mjs directly.
set -eu
exec node "$(dirname "$0")/verdant.mjs" "$@"
