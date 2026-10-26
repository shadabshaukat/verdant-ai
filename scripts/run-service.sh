#!/bin/sh
# Compatibility launcher. Node reads credentials directly from file mounts.
set -eu
exec node "$@"
