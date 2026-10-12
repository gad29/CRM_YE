#!/usr/bin/env bash
# Full CRM_YE backup: database + every file (documents, chat, templates).
#
#   scripts/backup.sh [backup-root]        default backup-root: ./backups
#
# Creates  <backup-root>/crmye-YYYY-MM-DD_HHMMSS/
#            database.dump   pg_dump custom format (restore with scripts/restore.sh)
#            files.tar.gz    DATA_DIR contents
#            MANIFEST.json   row counts + metadata, checked again on restore
#            SHA256SUMS      integrity of the two archives
# and deletes backups older than KEEP_DAYS (default 14).
#
# Reads DATABASE_URL and DATA_DIR from the environment or the app's .env files.
# Also the way to MOVE the system to another server — see DEPLOY.md.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

# Pull settings from the same .env files the app uses, without eval-ing them.
eval "$(node --input-type=module -e "
  import { loadEnv } from './scripts/lib/env.mjs';
  loadEnv(process.cwd());
  const q = (v) => \"'\" + String(v ?? '').replace(/'/g, \"'\\\\''\") + \"'\";
  console.log('DATABASE_URL=' + q(process.env.DATABASE_URL));
  console.log('DATA_DIR=' + q(process.env.DATA_DIR || './data'));
")"

[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL is not set" >&2; exit 1; }
command -v pg_dump >/dev/null || { echo "pg_dump not found (install postgresql-client)" >&2; exit 1; }

BACKUP_ROOT="${1:-$APP_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
OUT="$BACKUP_ROOT/crmye-$STAMP"
umask 077
mkdir -p "$OUT"

echo "[backup] database → $OUT/database.dump"
# Sessions, lockout counters and reset codes are transient: a restored system
# starts with everyone signed out and no stale lockouts.
pg_dump --format=custom --no-owner --no-acl \
  --exclude-table-data=public.sessions \
  --exclude-table-data=public.rate_limits \
  --exclude-table-data=public.password_resets \
  --dbname="$DATABASE_URL" --file="$OUT/database.dump"

echo "[backup] files ($DATA_DIR) → $OUT/files.tar.gz"
if [ -d "$DATA_DIR" ]; then
  # The old JSON store (data/db) is kept in the archive too, as history.
  (cd "$OUT" && tar -C "$DATA_DIR" -czf files.tar.gz .)
else
  (cd "$OUT" && tar -czf files.tar.gz --files-from /dev/null)
fi

COUNTS="$(node scripts/db-stats.mjs)"
FILE_COUNT="$(cd "$OUT" && tar -tzf files.tar.gz | grep -vc '/$' || true)"
cat > "$OUT/MANIFEST.json" <<EOF
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "host": "$(hostname)",
  "gitCommit": "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)",
  "rows": $COUNTS,
  "files": $FILE_COUNT
}
EOF
(cd "$OUT" && sha256sum database.dump files.tar.gz > SHA256SUMS)

echo "[backup] verifying archive"
pg_restore --list "$OUT/database.dump" >/dev/null
(cd "$OUT" && tar -tzf files.tar.gz >/dev/null)

if [ "$KEEP_DAYS" -gt 0 ] 2>/dev/null; then
  find "$BACKUP_ROOT" -maxdepth 1 -type d -name 'crmye-*' -mtime +"$KEEP_DAYS" -exec rm -rf {} +
fi

echo "[backup] done: $OUT ($(du -sh "$OUT" | cut -f1)) rows=$COUNTS files=$FILE_COUNT"
