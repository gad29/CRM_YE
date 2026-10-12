#!/usr/bin/env node
// One-time move of the old JSON store (DATA_DIR/db/*.json) into PostgreSQL.
//
// Safety model:
//   • The JSON files are only READ — never modified, moved or deleted.
//   • Everything happens in ONE transaction. After inserting, every record is
//     read back, mapped to its original JSON shape and deep-compared with the
//     source. Any difference — a changed value, an unknown field, a missing
//     record — rolls the whole import back. All or nothing.
//   • Refuses to import into a database that already holds CRM data.
//   • --dry-run performs the full import + verification, then rolls back.
//
//   node scripts/import-json.mjs --dry-run            rehearse, change nothing
//   node scripts/import-json.mjs                      import for real
//   node scripts/import-json.mjs --from /path/to/db   read JSON from another folder
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadEnv } from './lib/env.mjs';
import { migrate } from './db-migrate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(root);

pg.types.setTypeParser(1700, (v) => parseFloat(v));
pg.types.setTypeParser(20, (v) => Number(v));

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fromIndex = args.indexOf('--from');
const dataDir = path.resolve(root, process.env.DATA_DIR || './data');
const dbDir = fromIndex !== -1 ? path.resolve(args[fromIndex + 1]) : path.join(dataDir, 'db');

const log = (...m) => console.log(...m);
const fail = (message) => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

// ── Read the source ──────────────────────────────────────────────────────────

function readSource(name, fallback) {
  const file = path.join(dbDir, `${name}.json`);
  if (!fs.existsSync(file)) return { data: fallback, sha256: null, present: false };
  const raw = fs.readFileSync(file);
  let data;
  try {
    data = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    fail(`${file} is not valid JSON (${error.message}) — nothing was imported`);
  }
  return { data, sha256: crypto.createHash('sha256').update(raw).digest('hex'), present: true };
}

if (!fs.existsSync(dbDir)) fail(`JSON folder not found: ${dbDir}`);

const SOURCES = {
  clients: readSource('clients', []),
  cases: readSource('cases', []),
  documents: readSource('documents', []),
  payments: readSource('payments', []),
  tasks: readSource('tasks', []),
  workers: readSource('workers', []),
  admins: readSource('admins', []),
  activity: readSource('activity', []),
  chatChannels: readSource('chat-channels', []),
  chatMessages: readSource('chat-messages', []),
  counters: readSource('counters', {}),
  config: readSource('config', null),
  settings: readSource('settings', null),
};
const src = Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, v.data]));

for (const key of ['clients', 'cases', 'documents', 'payments', 'tasks', 'workers', 'admins', 'activity', 'chatChannels', 'chatMessages']) {
  if (!Array.isArray(src[key])) fail(`${key} JSON is not an array — nothing was imported`);
  const ids = src[key].map((r) => r.id);
  if (ids.some((id) => typeof id !== 'string' || !id)) fail(`${key} has a record without an id`);
  if (new Set(ids).size !== ids.length) fail(`${key} has duplicate ids`);
}

// ── Normalisation used for the comparison ────────────────────────────────────
// Absent and null mean the same thing to the app; timestamps compare as instants.

const TIMESTAMP_KEYS = new Set([
  'createdAt', 'updatedAt', 'openedAt', 'submittedAt', 'decisionAt', 'closedAt', 'uploadedAt', 'paidAt',
  'dueAt', 'remindAt', 'reminderSentAt', 'completedAt', 'at', 'deletedAt', 'reminderAt',
]);

function normalize(value, key) {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((v) => normalize(v));
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      const v = normalize(value[k], k);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (key && TIMESTAMP_KEYS.has(key) && typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? `INVALID:${value}` : new Date(t).toISOString();
  }
  return value;
}

/**
 * Differences between the JSON record (a) and what the database returns (b).
 * A field the JSON never had but the import filled with a default (e.g. a
 * missing updatedAt) is not a loss and is allowed; any other mismatch —
 * including a JSON field the database can't hold — is reported.
 */
function diff(a, b, at = '') {
  const out = [];
  if (a === undefined && b !== undefined) return [];
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) return [`${at || '(root)'}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`];
  if (a && typeof a === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) out.push(...diff(a[k], b[k], at ? `${at}.${k}` : k));
    return out;
  }
  return a === b ? [] : [`${at}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`];
}

// ── Row → JSON-domain mappers (mirror of lib/store.ts) ──────────────────────

const v = (x) => (x === null ? undefined : x);
const ts = (x) => (x === null || x === undefined ? undefined : new Date(x).toISOString());

const back = {
  client: (r) => ({ id: r.id, fullName: r.full_name, idNumber: v(r.id_number), phone: r.phone, email: v(r.email), address: v(r.address), city: v(r.city), notes: v(r.notes), createdBy: v(r.created_by), createdAt: ts(r.created_at), updatedAt: ts(r.updated_at) }),
  case: (r, items) => ({
    id: r.id, clientId: r.client_id, title: r.title, office: r.office, officeOther: v(r.office_other), description: v(r.description), stage: r.stage,
    checklist: items.map((i) => ({ code: i.code, label: i.label, status: i.status, note: v(i.note), documentIds: i.document_ids, updatedAt: ts(i.updated_at) })),
    company: v(r.company), caseKind: v(r.case_kind), troubleFlag: v(r.trouble_flag), troubleNote: v(r.trouble_note), openedBy: v(r.opened_by), assignedTo: v(r.assigned_to),
    fee: Number(r.fee), referenceNumber: v(r.reference_number), nextAction: v(r.next_action), notes: v(r.notes), decision: v(r.decision), decisionStatus: v(r.decision_status),
    investigationOutcome: v(r.investigation_outcome), paymentStatusOverride: v(r.payment_status_override), openedAt: ts(r.opened_at), submittedAt: ts(r.submitted_at),
    decisionAt: ts(r.decision_at), closedAt: ts(r.closed_at), updatedAt: ts(r.updated_at),
  }),
  document: (r) => ({ id: r.id, clientId: r.client_id, caseId: v(r.case_id), fileName: r.file_name, originalName: r.original_name, label: v(r.label), mimeType: r.mime_type, size: Number(r.size), uploadedAt: ts(r.uploaded_at), updatedAt: ts(r.updated_at), editedFromId: v(r.edited_from_id) }),
  payment: (r) => ({ id: r.id, clientId: r.client_id, caseId: v(r.case_id), amount: Number(r.amount), method: r.method, paidAt: ts(r.paid_at), note: v(r.note), createdAt: ts(r.created_at) }),
  task: (r) => ({ id: r.id, title: r.title, notes: v(r.notes), dueAt: ts(r.due_at), remindAt: ts(r.remind_at), reminderChannels: r.reminder_channels, reminderSentAt: ts(r.reminder_sent_at), priority: r.priority, assigneeId: r.assignee_id, clientId: v(r.client_id), caseId: v(r.case_id), status: r.status, createdBy: r.created_by, createdAt: ts(r.created_at), updatedAt: ts(r.updated_at), completedAt: ts(r.completed_at) }),
  person: (r) => ({ id: r.id, name: r.name, email: r.email, phone: v(r.phone), passwordHash: r.password_hash, active: r.active, createdAt: ts(r.created_at), updatedAt: ts(r.updated_at) }),
  activity: (r) => ({ id: r.id, type: r.type, clientId: v(r.client_id), caseId: v(r.case_id), summary: r.summary, at: ts(r.at) }),
  channel: (r) => ({ id: r.id, kind: r.kind, name: r.name, memberIds: r.member_ids, createdAt: ts(r.created_at), updatedAt: ts(r.updated_at) }),
  message: (r) => ({ id: r.id, channelId: r.channel_id, authorId: r.author_id, authorName: r.author_name, body: v(r.body), attachments: r.attachments, reminderTaskId: v(r.reminder_task_id), reminderAt: ts(r.reminder_at), reminderChannels: v(r.reminder_channels), readBy: r.read_by, createdAt: ts(r.created_at), deletedAt: ts(r.deleted_at) }),
};

// ── Import ───────────────────────────────────────────────────────────────────

const n = (x) => (x === undefined ? null : x);
const tsIn = (x) => (x === undefined || x === null ? null : x);

async function insertAll(client) {
  const q = (text, params) => client.query(text, params);

  for (const c of src.clients) {
    await q(
      `INSERT INTO clients (id, full_name, id_number, phone, email, address, city, notes, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [c.id, c.fullName, n(c.idNumber), c.phone ?? '', n(c.email), n(c.address), n(c.city), n(c.notes), n(c.createdBy), c.createdAt, c.updatedAt ?? c.createdAt],
    );
  }
  for (const c of src.cases) {
    await q(
      `INSERT INTO cases (id, client_id, title, office, office_other, description, stage, company, case_kind, trouble_flag, trouble_note,
              opened_by, assigned_to, fee, reference_number, next_action, notes, decision, decision_status, investigation_outcome,
              payment_status_override, opened_at, submitted_at, decision_at, closed_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [c.id, c.clientId, c.title, c.office, n(c.officeOther), n(c.description), c.stage, n(c.company), n(c.caseKind), n(c.troubleFlag), n(c.troubleNote),
        n(c.openedBy), n(c.assignedTo), c.fee ?? 0, n(c.referenceNumber), n(c.nextAction), n(c.notes), n(c.decision), n(c.decisionStatus), n(c.investigationOutcome),
        n(c.paymentStatusOverride), c.openedAt, tsIn(c.submittedAt), tsIn(c.decisionAt), tsIn(c.closedAt), c.updatedAt ?? c.openedAt],
    );
    for (const [position, item] of (c.checklist ?? []).entries()) {
      await q(
        `INSERT INTO case_checklist_items (case_id, code, position, label, status, note, document_ids, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [c.id, item.code, position, item.label, item.status, n(item.note), item.documentIds ?? [], item.updatedAt ?? c.updatedAt],
      );
    }
  }
  for (const d of src.documents) {
    await q(
      `INSERT INTO documents (id, client_id, case_id, file_name, original_name, label, mime_type, size, uploaded_at, updated_at, edited_from_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [d.id, d.clientId, n(d.caseId), d.fileName, d.originalName, n(d.label), d.mimeType, d.size, d.uploadedAt, d.updatedAt ?? d.uploadedAt, n(d.editedFromId)],
    );
  }
  for (const p of src.payments) {
    await q(
      `INSERT INTO payments (id, client_id, case_id, amount, method, paid_at, note, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [p.id, p.clientId, n(p.caseId), p.amount, p.method, p.paidAt, n(p.note), p.createdAt ?? p.paidAt],
    );
  }
  for (const t of src.tasks) {
    await q(
      `INSERT INTO tasks (id, title, notes, due_at, remind_at, reminder_channels, reminder_sent_at, priority, assignee_id, client_id, case_id,
              status, created_by, created_at, updated_at, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [t.id, t.title, n(t.notes), tsIn(t.dueAt), tsIn(t.remindAt), t.reminderChannels ?? [], tsIn(t.reminderSentAt), t.priority ?? 'normal', t.assigneeId ?? 'admin',
        n(t.clientId), n(t.caseId), t.status ?? 'open', t.createdBy ?? 'admin', t.createdAt, t.updatedAt ?? t.createdAt, tsIn(t.completedAt)],
    );
  }
  for (const [table, rows] of [['workers', src.workers], ['admins', src.admins]]) {
    for (const p of rows) {
      await q(
        `INSERT INTO ${table} (id, name, email, phone, password_hash, active, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [p.id, p.name, p.email, n(p.phone), p.passwordHash, p.active ?? true, p.createdAt, p.updatedAt ?? p.createdAt],
      );
    }
  }
  for (const a of src.activity) {
    await q('INSERT INTO activity (id, type, client_id, case_id, summary, at) VALUES ($1,$2,$3,$4,$5,$6)', [a.id, a.type, n(a.clientId), n(a.caseId), a.summary, a.at]);
  }
  for (const c of src.chatChannels) {
    await q('INSERT INTO chat_channels (id, kind, name, member_ids, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)', [c.id, c.kind, c.name ?? '', c.memberIds ?? [], c.createdAt, c.updatedAt ?? c.createdAt]);
  }
  for (const m of src.chatMessages) {
    await q(
      `INSERT INTO chat_messages (id, channel_id, author_id, author_name, body, attachments, reminder_task_id, reminder_at, reminder_channels, read_by, created_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [m.id, m.channelId, m.authorId, m.authorName, n(m.body), JSON.stringify(m.attachments ?? []), n(m.reminderTaskId), tsIn(m.reminderAt), n(m.reminderChannels), m.readBy ?? [], m.createdAt, tsIn(m.deletedAt)],
    );
  }

  // Counters: never hand out an id that already exists, even if counters.json lagged.
  const prefixes = { client: [src.clients, 'CL'], case: [src.cases, 'CASE'], document: [src.documents, 'DOC'], payment: [src.payments, 'PAY'], task: [src.tasks, 'TASK'], worker: [src.workers, 'WRK'], admin: [src.admins, 'ADM'], chatMessage: [src.chatMessages, 'MSG'] };
  const counters = { ...(src.counters ?? {}) };
  for (const [key, [rows, prefix]] of Object.entries(prefixes)) {
    const max = Math.max(0, ...rows.map((r) => Number(String(r.id).replace(`${prefix}-`, ''))).filter(Number.isFinite));
    if (max > (counters[key] ?? 0)) counters[key] = max;
  }
  for (const [key, value] of Object.entries(counters)) {
    await q('INSERT INTO counters (key, value) VALUES ($1, $2)', [key, value]);
  }

  if (src.config) await q('INSERT INTO app_kv (key, value) VALUES ($1, $2)', ['config', JSON.stringify(src.config)]);
  if (src.settings) await q('INSERT INTO app_kv (key, value) VALUES ($1, $2)', ['settings', JSON.stringify(src.settings)]);
  return counters;
}

async function verifyAll(client) {
  const problems = [];
  const rows = async (sql) => (await client.query(sql)).rows;

  const items = await rows('SELECT * FROM case_checklist_items ORDER BY case_id, position');
  const itemsByCase = new Map();
  for (const i of items) itemsByCase.set(i.case_id, [...(itemsByCase.get(i.case_id) ?? []), i]);

  const checks = [
    ['clients', src.clients, await rows('SELECT * FROM clients'), back.client],
    ['cases', src.cases, await rows('SELECT * FROM cases'), (r) => back.case(r, itemsByCase.get(r.id) ?? [])],
    ['documents', src.documents, await rows('SELECT * FROM documents'), back.document],
    ['payments', src.payments, await rows('SELECT * FROM payments'), back.payment],
    ['tasks', src.tasks, await rows('SELECT * FROM tasks'), back.task],
    ['workers', src.workers, await rows('SELECT * FROM workers'), back.person],
    ['admins', src.admins, await rows('SELECT * FROM admins'), back.person],
    ['activity', src.activity, await rows('SELECT * FROM activity'), back.activity],
    ['chat-channels', src.chatChannels, await rows('SELECT * FROM chat_channels'), back.channel],
    ['chat-messages', src.chatMessages, await rows('SELECT * FROM chat_messages'), back.message],
  ];

  const summary = [];
  for (const [name, source, dbRows, map] of checks) {
    const byId = new Map(dbRows.map((r) => [r.id, map(r)]));
    let identical = 0;
    for (const record of source) {
      const stored = byId.get(record.id);
      if (!stored) {
        problems.push(`${name} ${record.id}: missing from the database`);
        continue;
      }
      const differences = diff(normalize(record), normalize(stored));
      if (differences.length) problems.push(...differences.slice(0, 5).map((d) => `${name} ${record.id}: ${d}`));
      else identical += 1;
    }
    if (dbRows.length !== source.length) problems.push(`${name}: ${source.length} in JSON but ${dbRows.length} in the database`);
    summary.push([name, source.length, dbRows.length, identical]);
  }

  for (const [key, label] of [['config', 'config'], ['settings', 'settings']]) {
    if (!src[key]) continue;
    const row = (await client.query('SELECT value FROM app_kv WHERE key = $1', [key])).rows[0];
    const differences = diff(normalize(src[key]), normalize(row?.value));
    if (differences.length) problems.push(...differences.slice(0, 5).map((d) => `${label}: ${d}`));
    summary.push([label, 1, row ? 1 : 0, differences.length ? 0 : 1]);
  }
  return { problems, summary };
}

function checkFiles() {
  let present = 0;
  let bytes = 0;
  const missing = [];
  for (const d of src.documents) {
    const file = path.join(dataDir, 'clients', d.clientId, 'documents', d.fileName);
    if (fs.existsSync(file)) {
      present += 1;
      bytes += fs.statSync(file).size;
    } else missing.push(d.id);
  }
  let chatPresent = 0;
  const chatMissing = [];
  for (const m of src.chatMessages) {
    for (const a of m.attachments ?? []) {
      if (fs.existsSync(path.join(dataDir, 'chat', m.channelId, a.fileName))) chatPresent += 1;
      else chatMissing.push(`${m.id}/${a.id}`);
    }
  }
  return { present, bytes, missing, chatPresent, chatMissing };
}

// ── Main ─────────────────────────────────────────────────────────────────────

const connectionString = process.env.DATABASE_URL;
if (!connectionString) fail('DATABASE_URL is not set');

log(`CRM_YE JSON → PostgreSQL import${dryRun ? '  (DRY RUN — nothing will be saved)' : ''}`);
log(`  source: ${dbDir}`);
log(`  files:  ${dataDir}`);

await migrate({ connectionString, log: (m) => log(`  ${m}`) });

const client = new pg.Client({ connectionString });
await client.connect();
try {
  const existing = (
    await client.query(`SELECT (SELECT count(*) FROM clients) + (SELECT count(*) FROM cases) + (SELECT count(*) FROM documents)
                              + (SELECT count(*) FROM workers) + (SELECT count(*) FROM activity) AS n`)
  ).rows[0].n;
  if (Number(existing) > 0) {
    fail('The database already contains CRM data. Refusing to import twice. (Use an empty database.)');
  }

  await client.query('BEGIN');
  const counters = await insertAll(client);
  const { problems, summary } = await verifyAll(client);

  log('\n  table            JSON    DB   identical');
  for (const [name, a, b, same] of summary) log(`  ${name.padEnd(15)} ${String(a).padStart(5)} ${String(b).padStart(5)} ${String(same).padStart(10)}`);
  log(`  counters: ${JSON.stringify(counters)}`);

  const files = checkFiles();
  log(`\n  document files on disk: ${files.present}/${src.documents.length} (${(files.bytes / 1048576).toFixed(1)} MB)`);
  log(`  chat attachments on disk: ${files.chatPresent}/${files.chatPresent + files.chatMissing.length}`);
  if (files.missing.length) log(`  ⚠ documents whose file is missing on disk (were already missing before import): ${files.missing.slice(0, 20).join(', ')}`);
  if (files.chatMissing.length) log(`  ⚠ chat attachments missing on disk: ${files.chatMissing.slice(0, 20).join(', ')}`);

  if (problems.length) {
    await client.query('ROLLBACK');
    console.error(`\n✗ Verification found ${problems.length} difference(s) — the import was rolled back, nothing was saved:`);
    for (const p of problems.slice(0, 40)) console.error(`  - ${p}`);
    process.exit(1);
  }

  if (dryRun) {
    await client.query('ROLLBACK');
    log('\n✓ DRY RUN passed: every record was imported and read back identical. Rolled back — nothing was saved.');
  } else {
    await client.query('INSERT INTO app_kv (key, value) VALUES ($1, $2)', [
      'json-import',
      JSON.stringify({
        importedAt: new Date().toISOString(),
        source: dbDir,
        counts: Object.fromEntries(summary.map(([name, a]) => [name, a])),
        sha256: Object.fromEntries(Object.entries(SOURCES).filter(([, s]) => s.present).map(([k, s]) => [k, s.sha256])),
      }),
    ]);
    await client.query('COMMIT');
    log('\n✓ Import committed: every record was verified identical to the JSON source.');
    log('  The JSON files were not touched — keep them (and the backup) until you are happy with the new system.');
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  fail(`Import failed and was rolled back — nothing was saved: ${error.message}`);
} finally {
  await client.end();
}
