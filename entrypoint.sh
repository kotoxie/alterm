#!/bin/sh
set -e

# Ensure the data directory (which may be a bind-mount owned by root on the
# host) is writable by the node user before dropping privileges.
chown -R node:node /app/data

exec gosu node "$@"
