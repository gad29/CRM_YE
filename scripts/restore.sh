#!/usr/bin/env bash
# Restore a CRM_YE backup made by scripts/backup.sh — on this server or a new one.
#
#   scripts/restore.sh <backup-folder>
#
# Safety: checks SHA256SUMS first, refuses to restore over a database that
# already has CRM data or a DATA_DIR that already holds client folders, and
# compares the restored row counts with the backup's MANIFEST.json.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$(cd "${1:?usage: scripts/restore.sh <backup-folder>}" && pwd)"
cd "$APP_DIR"

eval "$(node --input-type=module -e "
  import { loadEnv } from './scripts/lib/env.mjs';
  loadEnv(process.cwd());
  const q = (v) => \"'\" + String(v ?? '').replace(/'/g, \"'\\\\''\") + \"'\";
  console.log('DATABASE_URL=' + q(process.env.DATABASE_URL));
  console.log('DATA_DIR=' + q(process.env.DATA_DIR || './data'));
")"
[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL is not set" >&2; exit 1; }

echo "[restore] checking archive integrity"
(cd "$SRC" && sha256sum -c SHA256SUMS >/dev/null) || { echo "Checksum mismatch — the backup is damaged, nothing was changed." >&2; exit 1; }

if ! node scripts/db-stats.mjs --empty; then
  echo "The target database already contains CRM data — refusing to overwrite it." >&2
  echo "Restore into a new, empty database (see DEPLOY.md)." >&2
  exit 1
fi
if [ -d "$DATA_DIR/clients" ] && [ -n "$(ls -A "$DATA_DIR/clients" 2>/dev/null)" ]; then
  echo "$DATA_DIR/clients already has client folders — refusing to overwrite them." >&2
  exit 1
fi

echo "[restore] database"
# The target was verified empty above; --clean replaces the empty tables a
# freshly started app may already have created.
pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error --dbname="$DATABASE_URL" "$SRC/database.dump"

echo "[restore] files → $DATA_DIR"
DATA_ABS="$(mkdir -p "$DATA_DIR" && cd "$DATA_DIR" && pwd)"
(cd "$SRC" && tar -C "$DATA_ABS" -xzf files.tar.gz)

echo "[restore] applying any newer migrations"
node scripts/db-migrate.mjs

echo "[restore] comparing row counts with the backup manifest"
node --input-type=module -e "
  import fs from 'node:fs';
  import { execFileSync } from 'node:child_process';
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  const now = JSON.parse(execFileSync('node', ['scripts/db-stats.mjs'], { encoding: 'utf8' }));
  let ok = true;
  for (const [table, expected] of Object.entries(manifest.rows)) {
    if (table === 'notification_log' || table === 'counters') continue;
    const mark = now[table] === expected ? '✓' : '✗';
    if (mark === '✗') ok = false;
    console.log('  ' + mark + ' ' + table.padEnd(22) + String(expected).padStart(7) + ' → ' + now[table]);
  }
  if (!ok) { console.error('Row counts differ from the backup!'); process.exit(1); }
  console.log('[restore] all row counts match the backup');
" "$SRC/MANIFEST.json"
