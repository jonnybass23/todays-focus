#!/bin/sh
# Today's Focus container entrypoint.
#
# Starts as root, adopts the host user's UID/GID (Unraid uses 99:100), makes the
# data dir writable by that user, then drops privileges and runs the app.
# Set PUID/PGID env vars to match your host; defaults to 1000:1000.
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

mkdir -p "$DATA_DIR"

# Only the data dir is written at runtime; /app stays root-owned and read-only.
chown -R "$PUID:$PGID" "$DATA_DIR" 2>/dev/null || \
  echo "  ▸ warning: could not chown $DATA_DIR — check the host folder's permissions"

echo "  ▸ Starting Today's Focus as ${PUID}:${PGID}"

# Drop from root to PUID:GID (numeric, so no matching /etc/passwd entry is needed)
# and exec the CMD (node server.js).
exec gosu "${PUID}:${PGID}" "$@"
