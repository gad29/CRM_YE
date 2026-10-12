#!/bin/sh
# Make the mounted data/backup folders writable by the app user, then drop root.
set -e
mkdir -p /app/data /app/backups
chown -R crmye:crmye /app/data /app/backups
exec su-exec crmye "$@"
