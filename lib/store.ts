// CRM_YE data store on PostgreSQL. Document, chat and template FILES stay on
// disk under DATA_DIR; everything else lives in the database (see migrations/).
//
// Multi-step changes run in transactions with row locks, so two people editing
// the same case can no longer overwrite each other the way the old JSON store
// (read-whole-file / write-whole-file) could.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  caseHandlerId,
  countMissingItems,
  DECISION_LABELS,
  DEFAULT_APP_CONFIG,
  DEFAULT_CASE_FIELDS,
  DEFAULT_CLIENT_FIELDS,
  DEFAULT_PHASES,
  DEFAULT_STAGES,
  DEFAULT_TRAYS,
  documentTemplates,
  INVESTIGATION_OUTCOME_LABELS,
  LEGACY_STAGE_MAP,
  officeDisplayName,
  isBuiltInStage,
  PHASE_IDS,
  PAYMENT_STATUS_LABELS,
  resolveStage,
  stageLabelOf,
  STAGE_LABELS,
  type ActivityRecord,
  type AdminRecord,
  type AppConfig,
  type CaseKind,
  type CaseRecord,
  type CaseStage,
  type ChecklistItem,
  type ChecklistStatus,
  type ClientRecord,
  type FieldDef,
  type StageDef,
  type DecisionStatus,
  type DocumentRecord,
  type GovernmentOffice,
  type InvestigationOutcome,
  type OperatingCompany,
  type PaymentMethod,
  type PaymentRecord,
  type PaymentStatus,
  type ReminderChannel,
  type TaskPriority,
  type TaskRecord,
  type WorkerRecord,
} from '@/lib/domain';
import { afterCommit, iso, isoOpt, nul, opt, sql, sqlCount, sqlOne, transaction } from '@/lib/db';
import { env } from '@/lib/env';
import { documentsLinkMessage, passwordResetMessage, taskAssignedMessage } from '@/lib/messages';
import { deliver, directChannelAvailable, type DeliveryChannel } from '@/lib/notify';
import { consumeRateLimit } from '@/lib/rate-limit';
import { signShareToken } from '@/lib/share';
import { assigneeContact, personDirectory } from '@/lib/users';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const appRoot = process.cwd();

// ── File locations (documents, chat files and templates stay on disk) ───────

export function dataRoot() {
  return path.isAbsolute(env.dataDir) ? env.dataDir : path.join(appRoot, env.dataDir);
}

/** Ids become folder names — refuse anything that could climb out of DATA_DIR. */
export function safeSegment(value: string) {
  if (!value || value.includes('/') || value.includes('\\') || value === '.' || value === '..' || value.includes('\0')) {
    throw new Error(`Unsafe path segment: ${JSON.stringify(value)}`);
  }
  return value;
}

export function clientFolder(clientId: string) {
  return path.join(dataRoot(), 'clients', safeSegment(clientId));
}

export function clientDocumentsFolder(clientId: string) {
  return path.join(clientFolder(clientId), 'documents');
}

function nowIso() {
  return new Date().toISOString();
}

// ── ID generation ────────────────────────────────────────────────────────────

/** Atomically allocate the next id for an entity, e.g. CL-1167. */
export async function nextId(prefix: string, counterKey: string, start = 1000) {
  const row = await sqlOne<{ value: number }>(
    `INSERT INTO counters (key, value) VALUES ($1, $2 + 1)
     ON CONFLICT (key) DO UPDATE SET value = counters.value + 1
     RETURNING value`,
    [counterKey, start],
  );
  return `${prefix}-${row!.value}`;
}

// ── Activity log ─────────────────────────────────────────────────────────────

export async function logActivity(input: { type: string; summary: string; clientId?: string; caseId?: string }) {
  const record: ActivityRecord = {
    id: crypto.randomUUID(),
    at: nowIso(),
    ...input,
  };
  await sql('INSERT INTO activity (id, type, client_id, case_id, summary, at) VALUES ($1, $2, $3, $4, $5, $6)', [
    record.id,
    record.type,
    record.clientId ?? null,
    record.caseId ?? null,
    record.summary,
    record.at,
  ]);
  return record;
}

function toActivity(row: Row): ActivityRecord {
  return {
    id: row.id,
    type: row.type,
    clientId: opt(row.client_id),
    caseId: opt(row.case_id),
    summary: row.summary,
    at: iso(row.at),
  };
}

export async function listActivity(options?: { clientId?: string; caseId?: string; limit?: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options?.clientId) {
    params.push(options.clientId);
    where.push(`client_id = $${params.length}`);
  }
  if (options?.caseId) {
    params.push(options.caseId);
    where.push(`case_id = $${params.length}`);
  }
  params.push(options?.limit ?? 50);
  const rows = await sql(
    `SELECT * FROM activity ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY at DESC, id DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(toActivity);
}

// ── Clients ──────────────────────────────────────────────────────────────────

function toClient(row: Row): ClientRecord {
  return {
    id: row.id,
    fullName: row.full_name,
    idNumber: opt(row.id_number),
    phone: row.phone,
    email: opt(row.email),
    address: opt(row.address),
    city: opt(row.city),
    notes: opt(row.notes),
    extra: row.extra ?? {},
    createdBy: opt(row.created_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

// Natural id order breaks timestamp ties (CL-999 before CL-1000).
const CLIENT_ORDER = 'ORDER BY created_at DESC, length(id) DESC, id DESC';

export async function listClients(): Promise<ClientRecord[]> {
  return (await sql(`SELECT * FROM clients ${CLIENT_ORDER}`)).map(toClient);
}

export async function getClient(clientId: string, options?: { forUpdate?: boolean }) {
  const row = await sqlOne(`SELECT * FROM clients WHERE id = $1${options?.forUpdate ? ' FOR UPDATE' : ''}`, [clientId]);
  return row ? toClient(row) : undefined;
}

export interface CreateClientInput {
  fullName: string;
  phone: string;
  idNumber?: string;
  email?: string;
  address?: string;
  city?: string;
  notes?: string;
  /** Values of fields added in Settings; an empty string clears one. */
  extra?: Record<string, string>;
  /** Worker id who created the client ('admin' for the admin). */
  createdBy?: string;
}

/** Merge new values of Settings-added fields into the saved ones; empty values are dropped. */
function mergeExtra(current: Record<string, string> | undefined, patch: Record<string, string> | undefined) {
  const next: Record<string, string> = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(patch ?? {})) {
    const trimmed = String(value ?? '').trim();
    if (trimmed) next[key] = trimmed.slice(0, 2000);
    else delete next[key];
  }
  return next;
}

export async function createClient(input: CreateClientInput): Promise<ClientRecord> {
  const record: ClientRecord = {
    id: await nextId('CL', 'client'),
    fullName: input.fullName.trim(),
    phone: input.phone.trim(),
    idNumber: input.idNumber?.trim() || undefined,
    email: input.email?.trim() || undefined,
    address: input.address?.trim() || undefined,
    city: input.city?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    extra: mergeExtra({}, input.extra),
    createdBy: input.createdBy || 'admin',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await writeClient(record, 'insert');
  fs.mkdirSync(clientDocumentsFolder(record.id), { recursive: true });
  await logActivity({ type: 'client-created', clientId: record.id, summary: `נפתח לקוח חדש: ${record.fullName}` });
  return record;
}

async function writeClient(record: ClientRecord, mode: 'insert' | 'update') {
  const values = [
    record.id,
    record.fullName,
    record.idNumber ?? null,
    record.phone,
    record.email ?? null,
    record.address ?? null,
    record.city ?? null,
    record.notes ?? null,
    record.createdBy ?? null,
    record.createdAt,
    record.updatedAt,
    JSON.stringify(record.extra ?? {}),
  ];
  if (mode === 'insert') {
    await sql(
      `INSERT INTO clients (id, full_name, id_number, phone, email, address, city, notes, created_by, created_at, updated_at, extra)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      values,
    );
  } else {
    await sql(
      `UPDATE clients SET full_name = $2, id_number = $3, phone = $4, email = $5, address = $6, city = $7,
              notes = $8, created_by = $9, created_at = $10, updated_at = $11, extra = $12
        WHERE id = $1`,
      values,
    );
  }
}

export async function updateClient(clientId: string, input: Partial<CreateClientInput>) {
  const updated = await transaction(async () => {
    const current = await getClient(clientId, { forUpdate: true });
    if (!current) return undefined;
    const { extra, ...plain } = input;
    const next: ClientRecord = {
      ...current,
      ...Object.fromEntries(Object.entries(plain).filter(([, v]) => v !== undefined)),
      extra: mergeExtra(current.extra, extra),
      updatedAt: nowIso(),
    };
    await writeClient(next, 'update');
    return next;
  });
  if (!updated) return undefined;
  await logActivity({ type: 'client-updated', clientId, summary: `עודכנו פרטי לקוח: ${updated.fullName}` });
  return updated;
}

/** Delete a client and everything belonging to them: cases, documents, payments, and their folder on disk. */
export async function deleteClient(clientId: string) {
  return transaction(async () => {
    const record = await getClient(clientId, { forUpdate: true });
    if (!record) return false;

    // Case by case (and document by document) so the activity log keeps the
    // same per-item trail it always had. Files are removed only after commit.
    for (const c of await listClientCases(clientId)) await deleteCase(c.id);
    for (const d of await listClientDocuments(clientId)) await deleteDocument(d.id);

    await sql('DELETE FROM payments WHERE client_id = $1', [clientId]);
    await sql('UPDATE tasks SET client_id = NULL WHERE client_id = $1', [clientId]);
    await sql('DELETE FROM clients WHERE id = $1', [clientId]);

    const folder = clientFolder(clientId);
    afterCommit(() => {
      try {
        fs.rmSync(folder, { recursive: true, force: true });
      } catch {
        /* folder may not exist */
      }
    });

    await logActivity({ type: 'client-deleted', summary: `נמחק לקוח: ${record.fullName}` });
    return true;
  });
}

// ── Cases ────────────────────────────────────────────────────────────────────

function toChecklistItem(row: Row): ChecklistItem {
  return {
    code: row.code,
    label: row.label,
    status: row.status as ChecklistStatus,
    note: opt(row.note),
    documentIds: row.document_ids ?? [],
    updatedAt: iso(row.updated_at),
  };
}

function toCase(row: Row, checklist: ChecklistItem[]): CaseRecord {
  // Normalize stage codes written by older versions.
  const stage = (LEGACY_STAGE_MAP[row.stage] ?? row.stage) as CaseStage;
  return {
    id: row.id,
    clientId: row.client_id,
    title: row.title,
    office: row.office as GovernmentOffice,
    officeOther: opt(row.office_other),
    description: opt(row.description),
    stage,
    checklist,
    company: opt(row.company) as OperatingCompany | undefined,
    caseKind: opt(row.case_kind) as CaseKind | undefined,
    troubleFlag: opt(row.trouble_flag),
    troubleNote: opt(row.trouble_note),
    openedBy: opt(row.opened_by),
    assignedTo: opt(row.assigned_to),
    fee: Number(row.fee),
    referenceNumber: opt(row.reference_number),
    nextAction: opt(row.next_action),
    notes: opt(row.notes),
    decision: opt(row.decision),
    decisionStatus: opt(row.decision_status) as DecisionStatus | undefined,
    investigationOutcome: opt(row.investigation_outcome) as InvestigationOutcome | undefined,
    paymentStatusOverride: opt(row.payment_status_override) as PaymentStatus | undefined,
    extra: row.extra ?? {},
    openedAt: iso(row.opened_at),
    submittedAt: isoOpt(row.submitted_at),
    decisionAt: isoOpt(row.decision_at),
    closedAt: isoOpt(row.closed_at),
    updatedAt: iso(row.updated_at),
  };
}

const CASE_ORDER = 'ORDER BY opened_at DESC, length(id) DESC, id DESC';

/** Load cases matching a WHERE clause together with their checklists. */
async function queryCases(where = '', params: unknown[] = [], lock = false): Promise<CaseRecord[]> {
  const rows = await sql(`SELECT * FROM cases ${where} ${CASE_ORDER}${lock ? ' FOR UPDATE' : ''}`, params);
  if (!rows.length) return [];
  const items = await sql('SELECT * FROM case_checklist_items WHERE case_id = ANY($1) ORDER BY case_id, position', [
    rows.map((r) => r.id),
  ]);
  const byCase = new Map<string, ChecklistItem[]>();
  for (const item of items) {
    const list = byCase.get(item.case_id) ?? [];
    list.push(toChecklistItem(item));
    byCase.set(item.case_id, list);
  }
  return rows.map((row) => toCase(row, byCase.get(row.id) ?? []));
}

export async function listCases(): Promise<CaseRecord[]> {
  return queryCases();
}

export async function getCase(caseId: string, options?: { forUpdate?: boolean }) {
  return (await queryCases('WHERE id = $1', [caseId], options?.forUpdate))[0];
}

export async function listClientCases(clientId: string) {
  return queryCases('WHERE client_id = $1', [clientId]);
}

async function writeCase(record: CaseRecord, mode: 'insert' | 'update') {
  const values = [
    record.id,
    record.clientId,
    record.title,
    record.office,
    record.officeOther ?? null,
    record.description ?? null,
    record.stage,
    record.company ?? null,
    record.caseKind ?? null,
    record.troubleFlag ?? null,
    record.troubleNote ?? null,
    record.openedBy ?? null,
    record.assignedTo ?? null,
    record.fee,
    record.referenceNumber ?? null,
    record.nextAction ?? null,
    record.notes ?? null,
    record.decision ?? null,
    record.decisionStatus ?? null,
    record.investigationOutcome ?? null,
    record.paymentStatusOverride ?? null,
    record.openedAt,
    record.submittedAt ?? null,
    record.decisionAt ?? null,
    record.closedAt ?? null,
    record.updatedAt,
    JSON.stringify(record.extra ?? {}),
  ];
  if (mode === 'insert') {
    await sql(
      `INSERT INTO cases (id, client_id, title, office, office_other, description, stage, company, case_kind,
              trouble_flag, trouble_note, opened_by, assigned_to, fee, reference_number, next_action, notes, decision,
              decision_status, investigation_outcome, payment_status_override, opened_at, submitted_at, decision_at,
              closed_at, updated_at, extra)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
               $23, $24, $25, $26, $27)`,
      values,
    );
  } else {
    await sql(
      `UPDATE cases SET client_id = $2, title = $3, office = $4, office_other = $5, description = $6, stage = $7,
              company = $8, case_kind = $9, trouble_flag = $10, trouble_note = $11, opened_by = $12, assigned_to = $13,
              fee = $14, reference_number = $15, next_action = $16, notes = $17, decision = $18, decision_status = $19,
              investigation_outcome = $20, payment_status_override = $21, opened_at = $22, submitted_at = $23,
              decision_at = $24, closed_at = $25, updated_at = $26, extra = $27
        WHERE id = $1`,
      values,
    );
  }
}

async function insertChecklistItem(caseId: string, item: ChecklistItem, position: number) {
  await sql(
    `INSERT INTO case_checklist_items (case_id, code, position, label, status, note, document_ids, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [caseId, item.code, position, item.label, item.status, item.note ?? null, item.documentIds, item.updatedAt],
  );
}

async function touchCase(caseId: string) {
  await sql('UPDATE cases SET updated_at = $2 WHERE id = $1', [caseId, nowIso()]);
}

export interface CreateCaseInput {
  clientId: string;
  title: string;
  office: GovernmentOffice;
  officeOther?: string;
  description?: string;
  fee?: number;
  nextAction?: string;
  company?: OperatingCompany;
  caseKind?: CaseKind;
  /** Worker id who opened the case ('admin' for the admin). */
  openedBy?: string;
  /** Template codes to seed the checklist with. */
  checklistCodes?: string[];
  /** Free-text custom checklist items. */
  customChecklist?: string[];
  referenceNumber?: string;
  /** Values of case fields added in Settings. */
  extra?: Record<string, string>;
}

export async function createCase(input: CreateCaseInput): Promise<CaseRecord | undefined> {
  const client = await getClient(input.clientId);
  if (!client) return undefined;

  const config = await getConfig();
  const checklist: ChecklistItem[] = [];
  for (const code of input.checklistCodes ?? []) {
    const label = templateLabel(config, code);
    if (label && !checklist.some((item) => item.code === code)) {
      checklist.push({ code, label, status: 'missing', documentIds: [], updatedAt: nowIso() });
    }
  }
  for (const label of input.customChecklist ?? []) {
    const trimmed = label.trim();
    if (!trimmed) continue;
    checklist.push({
      code: `custom-${crypto.randomUUID().slice(0, 8)}`,
      label: trimmed,
      status: 'missing',
      documentIds: [],
      updatedAt: nowIso(),
    });
  }

  const record: CaseRecord = {
    id: await nextId('CASE', 'case'),
    clientId: client.id,
    title: input.title.trim(),
    office: input.office,
    officeOther: input.officeOther?.trim() || undefined,
    description: input.description?.trim() || undefined,
    // A stage hidden in Settings is skipped to the next one shown.
    stage: resolveStage(config, checklist.length ? 'collecting-documents' : 'new-client'),
    checklist,
    company: input.company,
    caseKind: input.caseKind || 'new',
    troubleFlag: false,
    openedBy: input.openedBy || 'admin',
    fee: Number.isFinite(input.fee) && (input.fee as number) >= 0 ? Number(input.fee) : 0,
    nextAction: input.nextAction?.trim() || undefined,
    referenceNumber: input.referenceNumber?.trim() || undefined,
    extra: mergeExtra({}, input.extra),
    openedAt: nowIso(),
    updatedAt: nowIso(),
  };

  await transaction(async () => {
    await writeCase(record, 'insert');
    for (const [index, item] of checklist.entries()) await insertChecklistItem(record.id, item, index);
  });

  await logActivity({
    type: 'case-created',
    clientId: client.id,
    caseId: record.id,
    summary: `נפתח תיק חדש "${record.title}" (${officeDisplayName(record)}) עבור ${client.fullName}`,
  });
  return record;
}

export interface UpdateCaseInput {
  title?: string;
  office?: GovernmentOffice;
  officeOther?: string;
  description?: string;
  stage?: CaseStage;
  fee?: number;
  referenceNumber?: string;
  nextAction?: string;
  notes?: string;
  decision?: string;
  company?: OperatingCompany;
  caseKind?: CaseKind;
  troubleFlag?: boolean;
  troubleNote?: string;
  decisionStatus?: DecisionStatus;
  /** Empty string clears the outcome (e.g. when switching decision back to approved). */
  investigationOutcome?: InvestigationOutcome | '';
  /** Worker id to assign the case to; empty string clears the assignment. */
  assignedTo?: string;
  /** 'paid' | 'partial' | 'unpaid' to force a status; 'auto' or '' clears back to computed. */
  paymentStatusOverride?: PaymentStatus | 'auto' | '';
  /** Values of case fields added in Settings; an empty string clears one. */
  extra?: Record<string, string>;
}

export async function updateCase(caseId: string, input: UpdateCaseInput) {
  const result = await transaction(async () => {
    const current = await getCase(caseId, { forUpdate: true });
    if (!current) return undefined;
    const previousStage = current.stage;

    const { extra, ...plain } = input;
    const updated: CaseRecord = {
      ...current,
      ...Object.fromEntries(Object.entries(plain).filter(([, v]) => v !== undefined)),
      extra: mergeExtra(current.extra, extra),
      updatedAt: nowIso(),
    };
    if (input.assignedTo !== undefined) {
      updated.assignedTo = input.assignedTo.trim() || undefined;
    }
    if (input.investigationOutcome === '') {
      updated.investigationOutcome = undefined;
    }
    if (input.paymentStatusOverride !== undefined) {
      updated.paymentStatusOverride =
        input.paymentStatusOverride === 'auto' || input.paymentStatusOverride === ''
          ? undefined
          : input.paymentStatusOverride;
    }
    // A direct approval clears any previous investigation outcome.
    if (input.decisionStatus === 'approved') {
      updated.investigationOutcome = undefined;
    }

    if (input.stage && input.stage !== previousStage) {
      if (input.stage === 'submitted' && !updated.submittedAt) updated.submittedAt = nowIso();
      if (input.stage === 'decision-received' && !updated.decisionAt) updated.decisionAt = nowIso();
      if (input.stage === 'closed' && !updated.closedAt) updated.closedAt = nowIso();
    }

    await writeCase(updated, 'update');
    return { current, updated, previousStage };
  });
  if (!result) return undefined;
  const { current, updated, previousStage } = result;

  if (input.stage && input.stage !== previousStage) {
    const config = await getConfig();
    await logActivity({
      type: 'case-stage-changed',
      clientId: updated.clientId,
      caseId,
      summary: `שלב התיק "${updated.title}" עודכן: ${stageLabelOf(config, previousStage)} ← ${stageLabelOf(config, input.stage)}`,
    });
  } else {
    await logActivity({ type: 'case-updated', clientId: updated.clientId, caseId, summary: `עודכן תיק "${updated.title}"` });
  }

  if (input.assignedTo !== undefined && (current.assignedTo || undefined) !== updated.assignedTo) {
    const people = await personDirectory();
    const nameOf = (id: string) => people.get(id)?.name ?? id;
    await logActivity({
      type: 'case-assigned',
      clientId: updated.clientId,
      caseId,
      summary: `התיק "${updated.title}" הועבר מ${nameOf(caseHandlerId(current))} ל${nameOf(caseHandlerId(updated))}`,
    });
  }

  const decisionChanged =
    (input.decisionStatus !== undefined && input.decisionStatus !== current.decisionStatus) ||
    (input.investigationOutcome !== undefined && (input.investigationOutcome || undefined) !== current.investigationOutcome);
  if (decisionChanged) {
    const parts = [
      updated.decisionStatus ? `החלטה: ${DECISION_LABELS[updated.decisionStatus]}` : '',
      updated.investigationOutcome ? `תוצאת חקירה: ${INVESTIGATION_OUTCOME_LABELS[updated.investigationOutcome]}` : '',
    ].filter(Boolean);
    await logActivity({
      type: 'case-decision',
      clientId: updated.clientId,
      caseId,
      summary: `עודכנה החלטה בתיק "${updated.title}" — ${parts.join(', ') || 'נוקתה'}`,
    });
  }

  if (input.paymentStatusOverride !== undefined && current.paymentStatusOverride !== updated.paymentStatusOverride) {
    const label = updated.paymentStatusOverride
      ? PAYMENT_STATUS_LABELS[updated.paymentStatusOverride]
      : 'אוטומטי (לפי תשלומים)';
    await logActivity({
      type: 'case-payment-status',
      clientId: updated.clientId,
      caseId,
      summary: `סטטוס התשלום של "${updated.title}" עודכן ידנית ל: ${label}`,
    });
  }

  if (input.troubleFlag !== undefined && Boolean(current.troubleFlag) !== Boolean(input.troubleFlag)) {
    await logActivity({
      type: 'case-trouble-flag',
      clientId: updated.clientId,
      caseId,
      summary: input.troubleFlag
        ? `🚩 התיק "${updated.title}" סומן כתקוע / נדרשת השלמה${input.troubleNote ? `: ${input.troubleNote}` : ''}`
        : `הוסרה התראת הבעיה מהתיק "${updated.title}"`,
    });
  }

  return updated;
}

// ── Checklist ────────────────────────────────────────────────────────────────

export async function addChecklistItem(caseId: string, label: string, code?: string) {
  const config = await getConfig();
  const added = await transaction(async () => {
    const caseRecord = await getCase(caseId, { forUpdate: true });
    if (!caseRecord) return undefined;

    const tmplLabel = code ? templateLabel(config, code) : undefined;
    const item: ChecklistItem = {
      code: code && tmplLabel ? code : `custom-${crypto.randomUUID().slice(0, 8)}`,
      label: tmplLabel ?? label.trim(),
      status: 'missing',
      documentIds: [],
      updatedAt: nowIso(),
    };
    if (!item.label) return undefined;
    if (caseRecord.checklist.some((existing) => existing.code === item.code)) return undefined;

    const position = await sqlOne<{ next: number }>(
      'SELECT COALESCE(MAX(position) + 1, 0) AS next FROM case_checklist_items WHERE case_id = $1',
      [caseId],
    );
    await insertChecklistItem(caseId, item, position!.next);
    await touchCase(caseId);
    return { item, clientId: caseRecord.clientId };
  });
  if (!added) return undefined;
  await logActivity({ type: 'checklist-item-added', clientId: added.clientId, caseId, summary: `נוסף מסמך נדרש: ${added.item.label}` });
  return added.item;
}

export async function updateChecklistItem(
  caseId: string,
  code: string,
  input: { status?: ChecklistStatus; note?: string; label?: string },
) {
  const result = await transaction(async () => {
    const caseRecord = await getCase(caseId, { forUpdate: true });
    if (!caseRecord) return undefined;
    const item = caseRecord.checklist.find((i) => i.code === code);
    if (!item) return undefined;

    if (input.status) item.status = input.status;
    if (input.note !== undefined) item.note = input.note.trim() || undefined;
    if (input.label !== undefined && input.label.trim()) item.label = input.label.trim();
    item.updatedAt = nowIso();
    await sql(
      'UPDATE case_checklist_items SET status = $3, note = $4, label = $5, updated_at = $6 WHERE case_id = $1 AND code = $2',
      [caseId, code, item.status, item.note ?? null, item.label, item.updatedAt],
    );
    await touchCase(caseId);
    return { item, clientId: caseRecord.clientId };
  });
  if (!result) return undefined;

  if (input.status) {
    await logActivity({
      type: 'checklist-status-updated',
      clientId: result.clientId,
      caseId,
      summary: `סטטוס "${result.item.label}" עודכן`,
    });
  }
  return result.item;
}

export async function removeChecklistItem(caseId: string, code: string) {
  return (await removeChecklistItems(caseId, [code])) > 0;
}

/** Remove several checklist items at once; returns how many were removed. */
export async function removeChecklistItems(caseId: string, codes: string[]) {
  const caseRecord = await getCase(caseId);
  if (!caseRecord) return 0;
  const removed = await sqlCount('DELETE FROM case_checklist_items WHERE case_id = $1 AND code = ANY($2)', [
    caseId,
    codes,
  ]);
  if (removed > 0) {
    await touchCase(caseId);
    await logActivity({ type: 'checklist-items-removed', clientId: caseRecord.clientId, caseId, summary: `הוסרו ${removed} מסמכים מרשימת התיק` });
  }
  return removed;
}

/** Empty the whole checklist of a case; returns how many were removed. */
export async function clearChecklist(caseId: string) {
  const caseRecord = await getCase(caseId);
  if (!caseRecord) return 0;
  const removed = await sqlCount('DELETE FROM case_checklist_items WHERE case_id = $1', [caseId]);
  if (removed > 0) {
    await touchCase(caseId);
    await logActivity({ type: 'checklist-cleared', clientId: caseRecord.clientId, caseId, summary: 'נוקתה רשימת המסמכים הנדרשים' });
  }
  return removed;
}

/** Delete a case and cascade: its documents (files + records), payments, task links. */
export async function deleteCase(caseId: string) {
  return transaction(async () => {
    const record = await getCase(caseId, { forUpdate: true });
    if (!record) return false;

    for (const doc of await listCaseDocuments(caseId)) await deleteDocument(doc.id);
    await sql('DELETE FROM payments WHERE case_id = $1', [caseId]);
    await sql('UPDATE tasks SET case_id = NULL WHERE case_id = $1', [caseId]);
    await sql('DELETE FROM cases WHERE id = $1', [caseId]);

    await logActivity({ type: 'case-deleted', clientId: record.clientId, summary: `נמחק תיק "${record.title}"` });
    return true;
  });
}

// ── Documents ────────────────────────────────────────────────────────────────

function toDocument(row: Row): DocumentRecord {
  return {
    id: row.id,
    clientId: row.client_id,
    caseId: opt(row.case_id),
    fileName: row.file_name,
    originalName: row.original_name,
    label: opt(row.label),
    mimeType: row.mime_type,
    size: Number(row.size),
    uploadedAt: iso(row.uploaded_at),
    updatedAt: iso(row.updated_at),
    editedFromId: opt(row.edited_from_id),
  };
}

const DOCUMENT_ORDER = 'ORDER BY uploaded_at DESC, length(id) DESC, id DESC';

export async function listDocuments(): Promise<DocumentRecord[]> {
  return (await sql(`SELECT * FROM documents ${DOCUMENT_ORDER}`)).map(toDocument);
}

export async function getDocument(documentId: string) {
  const row = await sqlOne('SELECT * FROM documents WHERE id = $1', [documentId]);
  return row ? toDocument(row) : undefined;
}

export async function getDocuments(documentIds: string[]) {
  if (!documentIds.length) return [];
  return (await sql(`SELECT * FROM documents WHERE id = ANY($1) ${DOCUMENT_ORDER}`, [documentIds])).map(toDocument);
}

export async function listClientDocuments(clientId: string) {
  return (await sql(`SELECT * FROM documents WHERE client_id = $1 ${DOCUMENT_ORDER}`, [clientId])).map(toDocument);
}

export async function listCaseDocuments(caseId: string) {
  return (await sql(`SELECT * FROM documents WHERE case_id = $1 ${DOCUMENT_ORDER}`, [caseId])).map(toDocument);
}

function sanitizeFileName(name: string) {
  const base = path.basename(name).replace(/[-\\/:*?"<>|\s]/g, '_').trim();
  return base || 'file';
}

export function documentFilePath(record: Pick<DocumentRecord, 'clientId' | 'fileName'>) {
  return path.join(clientDocumentsFolder(record.clientId), safeSegment(path.basename(record.fileName)));
}

export interface SaveDocumentInput {
  clientId: string;
  caseId?: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  label?: string;
  editedFromId?: string;
  /** Checklist item to link + mark as received. */
  checklistCode?: string;
}

export async function saveDocument(input: SaveDocumentInput): Promise<DocumentRecord | undefined> {
  const client = await getClient(input.clientId);
  if (!client) return undefined;
  // A case id from the form must belong to this client.
  if (input.caseId) {
    const caseRow = await sqlOne('SELECT client_id FROM cases WHERE id = $1', [input.caseId]);
    if (!caseRow || caseRow.client_id !== input.clientId) return undefined;
  }

  const id = await nextId('DOC', 'document');
  const safeName = sanitizeFileName(input.originalName);
  const fileName = `${id}-${safeName}`;
  const folder = clientDocumentsFolder(input.clientId);
  fs.mkdirSync(folder, { recursive: true });
  const filePath = path.join(folder, fileName);
  fs.writeFileSync(filePath, input.buffer);

  const record: DocumentRecord = {
    id,
    clientId: input.clientId,
    caseId: input.caseId,
    fileName,
    originalName: safeName,
    label: input.label?.trim() || undefined,
    mimeType: input.mimeType || 'application/octet-stream',
    size: input.buffer.length,
    uploadedAt: nowIso(),
    updatedAt: nowIso(),
    editedFromId: input.editedFromId,
  };

  let checklistLabel = '';
  try {
    checklistLabel = await transaction(async () => {
      await sql(
        `INSERT INTO documents (id, client_id, case_id, file_name, original_name, label, mime_type, size, uploaded_at,
                                updated_at, edited_from_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          record.id,
          record.clientId,
          record.caseId ?? null,
          record.fileName,
          record.originalName,
          record.label ?? null,
          record.mimeType,
          record.size,
          record.uploadedAt,
          record.updatedAt,
          record.editedFromId ?? null,
        ],
      );

      if (!input.caseId || !input.checklistCode) return '';
      const item = await sqlOne(
        `UPDATE case_checklist_items
            SET document_ids = array_append(document_ids, $3),
                status = CASE WHEN status IN ('missing', 'resubmit-needed') THEN 'received' ELSE status END,
                updated_at = $4
          WHERE case_id = $1 AND code = $2
          RETURNING label`,
        [input.caseId, input.checklistCode, record.id, nowIso()],
      );
      if (!item) return '';
      await touchCase(input.caseId);
      return item.label as string;
    });
  } catch (error) {
    // The row never landed — don't leave an orphan file behind.
    fs.rmSync(filePath, { force: true });
    throw error;
  }

  await logActivity({
    type: record.editedFromId ? 'document-edited' : 'document-uploaded',
    clientId: input.clientId,
    caseId: input.caseId,
    summary: record.editedFromId
      ? `נשמרה גרסה ערוכה של מסמך: ${record.label || record.originalName}`
      : `הועלה מסמך: ${record.label || record.originalName}${checklistLabel ? ` (${checklistLabel})` : ''}`,
  });
  return record;
}

export async function updateDocumentMeta(documentId: string, input: { label?: string; caseId?: string | null }) {
  return transaction(async () => {
    const row = await sqlOne('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [documentId]);
    if (!row) return undefined;
    const record = toDocument(row);
    if (input.label !== undefined) record.label = input.label.trim() || undefined;
    if (input.caseId !== undefined) {
      if (input.caseId) {
        const caseRow = await sqlOne('SELECT client_id FROM cases WHERE id = $1', [input.caseId]);
        if (!caseRow || caseRow.client_id !== record.clientId) return undefined;
      }
      record.caseId = input.caseId || undefined;
    }
    record.updatedAt = nowIso();
    await sql('UPDATE documents SET label = $2, case_id = $3, updated_at = $4 WHERE id = $1', [
      documentId,
      record.label ?? null,
      record.caseId ?? null,
      record.updatedAt,
    ]);
    return record;
  });
}

export async function deleteDocument(documentId: string) {
  return transaction(async () => {
    const row = await sqlOne('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [documentId]);
    if (!row) return false;
    const record = toDocument(row);

    await sql('DELETE FROM documents WHERE id = $1', [documentId]);
    // Unlink from any checklist items.
    await sql(
      `UPDATE case_checklist_items SET document_ids = array_remove(document_ids, $1), updated_at = $2
        WHERE $1 = ANY(document_ids)`,
      [documentId, nowIso()],
    );

    const filePath = documentFilePath(record);
    afterCommit(() => {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });

    await logActivity({
      type: 'document-deleted',
      clientId: record.clientId,
      caseId: record.caseId,
      summary: `נמחק מסמך: ${record.label || record.originalName}`,
    });
    return true;
  });
}

export function readDocumentFile(record: Pick<DocumentRecord, 'clientId' | 'fileName'>) {
  const filePath = documentFilePath(record);
  if (!fs.existsSync(filePath)) return undefined;
  return fs.readFileSync(filePath);
}

export type SendChannel = DeliveryChannel;

const CHANNEL_LABEL: Record<SendChannel, string> = { email: 'אימייל', whatsapp: 'וואטסאפ' };

/**
 * Send one or more documents to their client as a single secure, expiring
 * download link by email (Resend) or WhatsApp (Meta). All documents must
 * belong to the same client. Returns the link on success.
 */
export async function sendDocumentsLink(documentIds: string[], channel: SendChannel) {
  const ids = Array.from(new Set(documentIds.filter(Boolean)));
  if (!ids.length) return { ok: false as const, error: 'לא נבחרו מסמכים' };

  const docs = await getDocuments(ids);
  if (!docs.length) return { ok: false as const, error: 'המסמכים לא נמצאו' };

  const clientId = docs[0].clientId;
  if (docs.some((d) => d.clientId !== clientId)) {
    return { ok: false as const, error: 'לא ניתן לשלוח מסמכים של לקוחות שונים בקישור אחד' };
  }
  const client = await getClient(clientId);
  if (!client) return { ok: false as const, error: 'הלקוח לא נמצא' };

  if (channel === 'email' && !client.email) return { ok: false as const, error: 'ללקוח אין כתובת אימייל' };
  if (channel === 'whatsapp' && !client.phone) return { ok: false as const, error: 'ללקוח אין מספר טלפון' };
  if (!directChannelAvailable(channel)) {
    return {
      ok: false as const,
      error:
        channel === 'email'
          ? 'שליחת אימייל לא הוגדרה — יש להגדיר RESEND_API_KEY ו-EMAIL_FROM'
          : 'שליחת וואטסאפ לא הוגדרה — יש להגדיר WHATSAPP_ACCESS_TOKEN ו-WHATSAPP_PHONE_NUMBER_ID',
    };
  }

  const token = signShareToken(docs.map((d) => d.id), 14);
  const link = `${env.appBaseUrl}/api/share/${token}`;
  const label = docs.length === 1 ? docs[0].label || docs[0].originalName : `${docs.length} מסמכים`;
  const { businessName } = await getConfig();

  const result = await deliver({
    channel,
    to: { email: client.email, phone: client.phone },
    message: documentsLinkMessage({ businessName, clientName: client.fullName, label, link, days: 14 }),
    relatedId: clientId,
  });
  if (!result.ok) return { ok: false as const, error: `השליחה נכשלה: ${result.error}` };

  await logActivity({
    type: 'document-sent',
    clientId,
    caseId: docs[0].caseId,
    summary: `נשלח קישור ל${label} ל${client.fullName} דרך ${CHANNEL_LABEL[channel]}`,
  });
  return { ok: true as const, link };
}

/** Single-document convenience wrapper. */
export async function sendDocumentLink(documentId: string, channel: SendChannel) {
  return sendDocumentsLink([documentId], channel);
}

// ── Payments ─────────────────────────────────────────────────────────────────

function toPayment(row: Row): PaymentRecord {
  return {
    id: row.id,
    clientId: row.client_id,
    caseId: opt(row.case_id),
    amount: Number(row.amount),
    method: row.method as PaymentMethod,
    paidAt: iso(row.paid_at),
    note: opt(row.note),
    createdAt: iso(row.created_at),
  };
}

const PAYMENT_ORDER = 'ORDER BY created_at DESC, length(id) DESC, id DESC';

export async function listPayments(): Promise<PaymentRecord[]> {
  return (await sql(`SELECT * FROM payments ${PAYMENT_ORDER}`)).map(toPayment);
}

export async function listCasePayments(caseId: string) {
  return (await sql(`SELECT * FROM payments WHERE case_id = $1 ${PAYMENT_ORDER}`, [caseId])).map(toPayment);
}

export async function listClientPayments(clientId: string) {
  return (await sql(`SELECT * FROM payments WHERE client_id = $1 ${PAYMENT_ORDER}`, [clientId])).map(toPayment);
}

export interface CreatePaymentInput {
  clientId: string;
  caseId?: string;
  amount: number;
  method: PaymentMethod;
  paidAt?: string;
  note?: string;
}

export async function createPayment(input: CreatePaymentInput): Promise<PaymentRecord | undefined> {
  const client = await getClient(input.clientId);
  if (!client) return undefined;
  if (!Number.isFinite(input.amount) || input.amount <= 0) return undefined;
  const caseRecord = input.caseId ? await getCase(input.caseId) : undefined;
  if (input.caseId && (!caseRecord || caseRecord.clientId !== input.clientId)) return undefined;

  const record: PaymentRecord = {
    id: await nextId('PAY', 'payment'),
    clientId: input.clientId,
    caseId: input.caseId,
    amount: Math.round(input.amount * 100) / 100,
    method: input.method,
    paidAt: input.paidAt ? iso(input.paidAt) : nowIso(),
    note: input.note?.trim() || undefined,
    createdAt: nowIso(),
  };

  await sql(
    `INSERT INTO payments (id, client_id, case_id, amount, method, paid_at, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [record.id, record.clientId, record.caseId ?? null, record.amount, record.method, record.paidAt, record.note ?? null, record.createdAt],
  );

  await logActivity({
    type: 'payment-recorded',
    clientId: input.clientId,
    caseId: input.caseId,
    summary: `נרשם תשלום של ₪${record.amount.toLocaleString()} מ${client.fullName}${caseRecord ? ` (תיק "${caseRecord.title}")` : ''}`,
  });
  return record;
}

export async function updatePayment(
  paymentId: string,
  input: { amount?: number; method?: PaymentMethod; paidAt?: string; note?: string; caseId?: string | null },
) {
  const result = await transaction(async () => {
    const row = await sqlOne('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
    if (!row) return undefined;
    const record = toPayment(row);
    const previousAmount = record.amount;

    if (input.amount !== undefined) {
      if (!Number.isFinite(input.amount) || input.amount <= 0) return undefined;
      record.amount = Math.round(input.amount * 100) / 100;
    }
    if (input.method) record.method = input.method;
    if (input.paidAt) record.paidAt = iso(input.paidAt);
    if (input.note !== undefined) record.note = input.note.trim() || undefined;
    if (input.caseId !== undefined) {
      if (input.caseId) {
        const caseRow = await sqlOne('SELECT client_id FROM cases WHERE id = $1', [input.caseId]);
        if (!caseRow || caseRow.client_id !== record.clientId) return undefined;
      }
      record.caseId = input.caseId || undefined;
    }

    await sql('UPDATE payments SET amount = $2, method = $3, paid_at = $4, note = $5, case_id = $6 WHERE id = $1', [
      paymentId,
      record.amount,
      record.method,
      record.paidAt,
      record.note ?? null,
      record.caseId ?? null,
    ]);
    return { record, previousAmount };
  });
  if (!result) return undefined;
  const { record, previousAmount } = result;
  await logActivity({
    type: 'payment-updated',
    clientId: record.clientId,
    caseId: record.caseId,
    summary:
      input.amount !== undefined && input.amount !== previousAmount
        ? `עודכן תשלום ${record.id}: ₪${previousAmount.toLocaleString()} ← ₪${record.amount.toLocaleString()}`
        : `עודכנו פרטי תשלום ${record.id}`,
  });
  return record;
}

export async function deletePayment(paymentId: string) {
  const row = await sqlOne('DELETE FROM payments WHERE id = $1 RETURNING *', [paymentId]);
  if (!row) return false;
  const record = toPayment(row);
  await logActivity({
    type: 'payment-deleted',
    clientId: record.clientId,
    caseId: record.caseId,
    summary: `נמחק תשלום של ₪${record.amount.toLocaleString()}`,
  });
  return true;
}

// ── Finance / summaries ──────────────────────────────────────────────────────

export interface CaseFinance {
  caseId: string;
  fee: number;
  paid: number;
  balance: number;
  status: PaymentStatus;
  /** True when the status was set manually rather than computed from payments. */
  overridden: boolean;
}

/** Finance for one case, given the payments to count (all payments, or the case's own). */
export function getCaseFinance(
  caseRecord: Pick<CaseRecord, 'id' | 'fee' | 'paymentStatusOverride'>,
  payments: PaymentRecord[],
): CaseFinance {
  const casePayments = payments.filter((p) => p.caseId === caseRecord.id);
  const paid = Math.round(casePayments.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
  let balance = Math.max(0, Math.round((caseRecord.fee - paid) * 100) / 100);
  let status: PaymentStatus =
    caseRecord.fee <= 0 && paid <= 0 ? 'unpaid' : paid <= 0 ? 'unpaid' : paid < caseRecord.fee ? 'partial' : 'paid';

  const override = caseRecord.paymentStatusOverride;
  if (override === 'paid') {
    status = 'paid';
    balance = 0;
  } else if (override === 'unpaid') {
    status = 'unpaid';
  } else if (override === 'partial') {
    status = 'partial';
  }

  return { caseId: caseRecord.id, fee: caseRecord.fee, paid, balance, status, overridden: Boolean(override) };
}

export async function getDashboardSummary(caseFilter?: (caseRecord: CaseRecord) => boolean) {
  const [allCases, allClients, payments] = await Promise.all([listCases(), listClients(), listPayments()]);
  const cases = caseFilter ? allCases.filter(caseFilter) : allCases;
  const clients = caseFilter
    ? allClients.filter((client) => cases.some((c) => c.clientId === client.id))
    : allClients;

  const byStage: Record<string, number> = {};
  for (const stage of Object.keys(STAGE_LABELS)) byStage[stage] = 0;
  let missingDocsCases = 0;
  let actionRequired = 0;
  for (const caseRecord of cases) {
    byStage[caseRecord.stage] = (byStage[caseRecord.stage] ?? 0) + 1;
    if (caseRecord.stage !== 'closed' && countMissingItems(caseRecord) > 0) missingDocsCases += 1;
    if (caseRecord.stage === 'action-required') actionRequired += 1;
  }

  const openCases = cases.filter((c) => c.stage !== 'closed');
  const finance = cases.map((c) => getCaseFinance(c, payments));
  const totalFees = finance.reduce((sum, f) => sum + f.fee, 0);
  const totalPaid = finance.reduce((sum, f) => sum + f.paid, 0);
  const totalOutstanding = finance.reduce((sum, f) => sum + f.balance, 0);

  const troubleCases = cases.filter((c) => c.troubleFlag && c.stage !== 'closed').length;

  return {
    clients: clients.length,
    cases: cases.length,
    openCases: openCases.length,
    closedCases: cases.length - openCases.length,
    missingDocsCases,
    actionRequired,
    troubleCases,
    byStage,
    totalFees,
    totalPaid,
    totalOutstanding,
  };
}

// ── Session-based visibility ─────────────────────────────────────────────────

export type Viewer = { role: 'admin' } | { role: 'worker'; workerId: string };

/** Admins see every case; a worker sees the cases they currently handle (see caseHandlerId). */
export function caseVisibleTo(caseRecord: Pick<CaseRecord, 'openedBy' | 'assignedTo'>, viewer: Viewer) {
  if (viewer.role === 'admin') return true;
  return caseHandlerId(caseRecord) === viewer.workerId;
}

export async function listVisibleCases(viewer: Viewer) {
  if (viewer.role === 'admin') return listCases();
  return queryCases('WHERE COALESCE(assigned_to, opened_by) = $1', [viewer.workerId]);
}

export async function clientVisibleTo(client: Pick<ClientRecord, 'id' | 'createdBy'>, viewer: Viewer) {
  if (viewer.role === 'admin') return true;
  if (client.createdBy === viewer.workerId) return true;
  const row = await sqlOne('SELECT 1 FROM cases WHERE client_id = $1 AND COALESCE(assigned_to, opened_by) = $2 LIMIT 1', [
    client.id,
    viewer.workerId,
  ]);
  return Boolean(row);
}

export async function listVisibleClients(viewer: Viewer) {
  if (viewer.role === 'admin') return listClients();
  const rows = await sql(
    `SELECT * FROM clients c
      WHERE c.created_by = $1
         OR EXISTS (SELECT 1 FROM cases k WHERE k.client_id = c.id AND COALESCE(k.assigned_to, k.opened_by) = $1)
      ${CLIENT_ORDER}`,
    [viewer.workerId],
  );
  return rows.map(toClient);
}

export async function documentVisibleTo(doc: Pick<DocumentRecord, 'clientId'>, viewer: Viewer) {
  if (viewer.role === 'admin') return true;
  const client = await getClient(doc.clientId);
  return Boolean(client && (await clientVisibleTo(client, viewer)));
}

// ── Tasks & reminders ────────────────────────────────────────────────────────

export function toTask(row: Row): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    notes: opt(row.notes),
    dueAt: isoOpt(row.due_at),
    remindAt: isoOpt(row.remind_at),
    reminderChannels: (row.reminder_channels ?? []) as ReminderChannel[],
    reminderSentAt: isoOpt(row.reminder_sent_at),
    priority: row.priority as TaskPriority,
    assigneeId: row.assignee_id,
    clientId: opt(row.client_id),
    caseId: opt(row.case_id),
    status: row.status,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: isoOpt(row.completed_at),
    watchKind: opt(row.watch_kind) as TaskRecord['watchKind'],
    watchRef: opt(row.watch_ref),
    resolvedReason: opt(row.resolved_reason),
  };
}

const TASK_ORDER = 'ORDER BY created_at DESC, length(id) DESC, id DESC';

export async function listTasks(): Promise<TaskRecord[]> {
  return (await sql(`SELECT * FROM tasks ${TASK_ORDER}`)).map(toTask);
}

export async function getTask(taskId: string) {
  const row = await sqlOne('SELECT * FROM tasks WHERE id = $1', [taskId]);
  return row ? toTask(row) : undefined;
}

export function taskVisibleTo(task: Pick<TaskRecord, 'assigneeId' | 'createdBy'>, viewer: Viewer) {
  if (viewer.role === 'admin') return true;
  return task.assigneeId === viewer.workerId || task.createdBy === viewer.workerId;
}

export async function listVisibleTasks(viewer: Viewer) {
  if (viewer.role === 'admin') return listTasks();
  return (await sql(`SELECT * FROM tasks WHERE assignee_id = $1 OR created_by = $1 ${TASK_ORDER}`, [viewer.workerId])).map(toTask);
}


export interface CreateTaskInput {
  title: string;
  notes?: string;
  dueAt?: string;
  remindAt?: string;
  reminderChannels?: ReminderChannel[];
  priority?: TaskPriority;
  assigneeId?: string;
  clientId?: string;
  caseId?: string;
  createdBy: string;
  watchKind?: TaskRecord['watchKind'];
  watchRef?: string;
}

export async function createTask(input: CreateTaskInput): Promise<TaskRecord | undefined> {
  const title = input.title.trim();
  if (!title) return undefined;

  const record: TaskRecord = {
    id: await nextId('TASK', 'task'),
    title,
    notes: input.notes?.trim() || undefined,
    dueAt: input.dueAt ? iso(input.dueAt) : undefined,
    remindAt: input.remindAt ? iso(input.remindAt) : undefined,
    reminderChannels: input.reminderChannels?.filter((c) => c === 'email' || c === 'whatsapp') ?? [],
    priority: input.priority ?? 'normal',
    assigneeId: input.assigneeId || 'admin',
    clientId: input.clientId || undefined,
    caseId: input.caseId || undefined,
    status: 'open',
    createdBy: input.createdBy,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    watchKind: input.watchKind,
    watchRef: input.watchKind ? input.watchRef : undefined,
  };

  await sql(
    `INSERT INTO tasks (id, title, notes, due_at, remind_at, reminder_channels, priority, assignee_id, client_id,
                        case_id, status, created_by, created_at, updated_at, watch_kind, watch_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      record.id,
      record.title,
      record.notes ?? null,
      record.dueAt ?? null,
      record.remindAt ?? null,
      record.reminderChannels,
      record.priority,
      record.assigneeId,
      nul(record.clientId),
      nul(record.caseId),
      record.status,
      record.createdBy,
      record.createdAt,
      record.updatedAt,
      nul(record.watchKind),
      nul(record.watchRef),
    ],
  );

  const assignee = await assigneeContact(record.assigneeId);
  await logActivity({
    type: 'task-created',
    clientId: record.clientId,
    caseId: record.caseId,
    summary: `נוצרה משימה: "${record.title}" (${assignee.name})`,
  });
  if (record.assigneeId !== record.createdBy) {
    await notifyTaskAssigned(record, assignee);
  }
  return record;
}

/** Tell the assignee about a new task on every channel that is set up and reachable. */
async function notifyTaskAssigned(record: TaskRecord, assignee: Awaited<ReturnType<typeof assigneeContact>>) {
  const channels = (['email', 'whatsapp'] as const).filter(
    (channel) => directChannelAvailable(channel) && (channel === 'email' ? assignee.email : assignee.phone),
  );
  if (!channels.length) return;
  const { businessName } = await getConfig();
  const message = taskAssignedMessage({
    businessName,
    assigneeName: assignee.name,
    title: record.title,
    dueAt: record.dueAt,
    notes: record.notes,
    link: `${env.appBaseUrl}/tasks`,
  });
  for (const channel of channels) {
    void deliver({ channel, to: { email: assignee.email, phone: assignee.phone }, message, relatedId: record.id });
  }
}

export interface UpdateTaskInput {
  title?: string;
  notes?: string;
  dueAt?: string | null;
  remindAt?: string | null;
  reminderChannels?: ReminderChannel[];
  priority?: TaskPriority;
  assigneeId?: string;
  status?: 'open' | 'done';
}

export async function updateTask(taskId: string, input: UpdateTaskInput) {
  const result = await transaction(async () => {
    const row = await sqlOne('SELECT * FROM tasks WHERE id = $1 FOR UPDATE', [taskId]);
    if (!row) return undefined;
    const record = toTask(row);
    let rearmed = false;
    let statusChanged = false;

    if (input.title?.trim()) record.title = input.title.trim();
    if (input.notes !== undefined) record.notes = input.notes.trim() || undefined;
    if (input.dueAt !== undefined) record.dueAt = input.dueAt ? iso(input.dueAt) : undefined;
    if (input.remindAt !== undefined) {
      record.remindAt = input.remindAt ? iso(input.remindAt) : undefined;
      // Rescheduling a reminder re-arms it.
      record.reminderSentAt = undefined;
      rearmed = true;
    }
    if (input.reminderChannels) record.reminderChannels = input.reminderChannels.filter((c) => c === 'email' || c === 'whatsapp');
    if (input.priority) record.priority = input.priority;
    if (input.assigneeId) record.assigneeId = input.assigneeId;
    if (input.status && input.status !== record.status) {
      record.status = input.status;
      record.completedAt = input.status === 'done' ? nowIso() : undefined;
      record.resolvedReason = undefined;
      statusChanged = true;
    }
    record.updatedAt = nowIso();

    await sql(
      `UPDATE tasks SET title = $2, notes = $3, due_at = $4, remind_at = $5, reminder_channels = $6,
              reminder_sent_at = $7, priority = $8, assignee_id = $9, status = $10, updated_at = $11, completed_at = $12,
              reminder_attempts = CASE WHEN $13 THEN 0 ELSE reminder_attempts END,
              resolved_reason = CASE WHEN $14 THEN NULL ELSE resolved_reason END
        WHERE id = $1`,
      [
        taskId,
        record.title,
        record.notes ?? null,
        record.dueAt ?? null,
        record.remindAt ?? null,
        record.reminderChannels,
        record.reminderSentAt ?? null,
        record.priority,
        record.assigneeId,
        record.status,
        record.updatedAt,
        record.completedAt ?? null,
        rearmed,
        statusChanged,
      ],
    );
    return { record, statusChanged };
  });
  if (!result) return undefined;
  const { record, statusChanged } = result;
  if (statusChanged) {
    await logActivity({
      type: record.status === 'done' ? 'task-completed' : 'task-reopened',
      clientId: record.clientId,
      caseId: record.caseId,
      summary: record.status === 'done' ? `הושלמה משימה: "${record.title}"` : `נפתחה מחדש משימה: "${record.title}"`,
    });
  }
  return record;
}

export async function deleteTask(taskId: string) {
  return (await sqlCount('DELETE FROM tasks WHERE id = $1', [taskId])) > 0;
}

/** Who a reminder goes to and what it is about (used by lib/reminders.ts). */
export async function reminderContext(task: TaskRecord) {
  const [assignee, client, caseRecord] = await Promise.all([
    assigneeContact(task.assigneeId),
    task.clientId ? getClient(task.clientId) : undefined,
    task.caseId ? getCase(task.caseId) : undefined,
  ]);
  return {
    assignee,
    clientName: client?.fullName,
    caseTitle: caseRecord?.title,
    link: `${env.appBaseUrl}/tasks`,
  };
}

// ── Settings (blank rent-contract template, etc.) ────────────────────────────

export interface AppSettings {
  blankContract?: {
    fileName: string;
    originalName: string;
    mimeType: string;
    uploadedAt: string;
  };
}

function templatesFolder() {
  return path.join(dataRoot(), 'templates');
}

async function readKv<T>(key: string, fallback: T): Promise<T> {
  const row = await sqlOne<{ value: T }>('SELECT value FROM app_kv WHERE key = $1', [key]);
  return row ? row.value : fallback;
}

async function writeKv(key: string, value: unknown) {
  await sql(
    `INSERT INTO app_kv (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

export async function getSettings(): Promise<AppSettings> {
  return readKv<AppSettings>('settings', {});
}

async function saveSettings(settings: AppSettings) {
  await writeKv('settings', settings);
}

// ── App configuration (fully editable from the Settings page) ────────────────

/** Saved config may still carry the stage names of older versions. */
type SavedConfig = Partial<AppConfig> & { stageLabels?: Record<string, string> };

const STAGE_TRAYS = ['ready', 'office', 'payment'];
const FIELD_TYPES = ['text', 'longtext', 'phone', 'email', 'number', 'date', 'select', 'yesno'];
const FIELD_NEEDS = ['optional', 'needed', 'required'];
export const CUSTOM_STAGE_CODE = /^st-[a-z0-9]{1,16}$/;
export const CUSTOM_FIELD_KEY = /^f-[a-z0-9]{1,16}$/;

const clip = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * The pipeline in a safe shape: every built-in stage present (they can be
 * hidden, not removed), grouped by phase in phase order, 'closed' last and shown.
 */
export function normalizeStages(list: StageDef[] | undefined, legacyLabels?: Record<string, string>): StageDef[] {
  const source = list?.length
    ? list
    : DEFAULT_STAGES.map((s) => ({ ...s, label: clip(legacyLabels?.[s.code], 60) || s.label }));
  const seen = new Set<string>();
  const out: StageDef[] = [];
  for (const st of source) {
    if (!st || typeof st.code !== 'string' || seen.has(st.code)) continue;
    if (!isBuiltInStage(st.code) && !CUSTOM_STAGE_CODE.test(st.code)) continue;
    seen.add(st.code);
    const hint = clip(st.hint, 300);
    out.push({
      code: st.code,
      label: clip(st.label, 60) || stageLabelOf(undefined, st.code),
      phase: PHASE_IDS.includes(st.phase) ? st.phase : 'intake',
      ...(st.hidden && st.code !== 'closed' ? { hidden: true } : {}),
      ...(hint ? { hint } : {}),
      ...(st.tray && STAGE_TRAYS.includes(st.tray) ? { tray: st.tray } : {}),
    });
  }
  for (const d of DEFAULT_STAGES) if (!seen.has(d.code)) out.push({ ...d });
  const closed = out.find((s) => s.code === 'closed')!;
  closed.phase = 'finish';
  return [...PHASE_IDS.flatMap((p) => out.filter((s) => s.phase === p && s.code !== 'closed')), closed];
}

/** Field list in a safe shape: built-ins keep their key and type and can't be removed. */
export function normalizeFields(list: FieldDef[] | undefined, defaults: FieldDef[]): FieldDef[] {
  const source = list?.length ? list : defaults;
  const seen = new Set<string>();
  const out: FieldDef[] = [];
  for (const f of source) {
    if (!f || typeof f.key !== 'string' || seen.has(f.key)) continue;
    const builtIn = defaults.find((d) => d.key === f.key);
    if (!builtIn && !CUSTOM_FIELD_KEY.test(f.key)) continue;
    seen.add(f.key);
    const type = builtIn ? builtIn.type : FIELD_TYPES.includes(f.type) ? f.type : 'text';
    const options =
      !builtIn && type === 'select' && Array.isArray(f.options)
        ? [...new Set(f.options.map((o) => clip(o, 80)).filter(Boolean))].slice(0, 50)
        : undefined;
    const placeholder = clip(f.placeholder, 80);
    out.push({
      key: f.key,
      label: clip(f.label, 60) || builtIn?.label || 'שדה',
      type,
      ...(options ? { options } : {}),
      visible: f.visible !== false,
      need: FIELD_NEEDS.includes(f.need) ? f.need : 'optional',
      ...(builtIn ? { builtIn: true } : {}),
      ...(f.inList ? { inList: true } : {}),
      ...(placeholder ? { placeholder } : {}),
    });
  }
  for (const d of defaults) if (!seen.has(d.key)) out.push({ ...d });
  return out;
}

function mergeConfig(saved: SavedConfig): AppConfig {
  const { stageLabels, ...rest } = saved;
  return {
    ...DEFAULT_APP_CONFIG,
    ...rest,
    companies: saved.companies?.length ? saved.companies : DEFAULT_APP_CONFIG.companies,
    documentTemplates: saved.documentTemplates?.length ? saved.documentTemplates : DEFAULT_APP_CONFIG.documentTemplates,
    paymentMethods: saved.paymentMethods?.length ? saved.paymentMethods : DEFAULT_APP_CONFIG.paymentMethods,
    offices: saved.offices?.length ? saved.offices : DEFAULT_APP_CONFIG.offices,
    stages: normalizeStages(saved.stages, stageLabels),
    phases: DEFAULT_PHASES.map((p) => ({ ...p, label: clip(saved.phases?.find((s) => s.id === p.id)?.label, 40) || p.label })),
    trays: DEFAULT_TRAYS.map((t) => {
      const own = saved.trays?.find((s) => s.id === t.id);
      return {
        ...t,
        label: clip(own?.label, 40) || t.label,
        hint: own?.hint !== undefined ? clip(own.hint, 80) : t.hint,
        ...(own?.hidden ? { hidden: true } : {}),
      };
    }),
    clientFields: normalizeFields(saved.clientFields, DEFAULT_CLIENT_FIELDS),
    caseFields: normalizeFields(saved.caseFields, DEFAULT_CASE_FIELDS),
    modules: { ...DEFAULT_APP_CONFIG.modules, ...(saved.modules ?? {}) },
    texts: saved.texts && typeof saved.texts === 'object' ? saved.texts : {},
  };
}

export async function getConfig(): Promise<AppConfig> {
  return mergeConfig(await readKv<SavedConfig>('config', {}));
}

/** Raised when saving would remove a stage that still has cases in it. */
export class StageInUseError extends Error {
  constructor(public readonly inUse: { code: string; label: string; cases: number }[]) {
    super(`יש תיקים בשלבים שהוסרו: ${inUse.map((s) => `${s.label} (${s.cases})`).join(', ')}`);
  }
}

/**
 * Save part of the config. `stageMoves` ({ from: to }) first moves the cases of
 * stages being removed; a removed stage that still has cases refuses the save.
 */
export async function saveConfig(patch: Partial<AppConfig>, stageMoves: Record<string, string> = {}): Promise<AppConfig> {
  let moved = 0;
  const next = await transaction(async () => {
    await sql("SELECT pg_advisory_xact_lock(hashtext('crmye-config'))");
    const saved = await readKv<SavedConfig>('config', {});
    const merged: SavedConfig = { ...saved, ...patch };
    if (patch.stages) {
      const before = mergeConfig(saved).stages;
      const after = normalizeStages(patch.stages);
      const kept = new Set(after.map((s) => s.code));
      for (const [from, to] of Object.entries(stageMoves)) {
        if (kept.has(from) || !kept.has(to)) continue;
        moved += (await sql('UPDATE cases SET stage = $2, updated_at = $3 WHERE stage = $1 RETURNING id', [from, to, nowIso()])).length;
      }
      const removed = before.filter((s) => !kept.has(s.code));
      if (removed.length) {
        const counts = await sql('SELECT stage, count(*)::int AS n FROM cases WHERE stage = ANY($1) GROUP BY stage', [removed.map((s) => s.code)]);
        if (counts.length) {
          throw new StageInUseError(counts.map((r) => ({ code: r.stage, label: stageLabelOf({ stages: before }, r.stage), cases: r.n })));
        }
      }
      merged.stages = after;
      delete merged.stageLabels;
    }
    await writeKv('config', merged);
    return merged;
  });
  await logActivity({
    type: 'config-updated',
    summary: moved ? `עודכנו הגדרות המערכת; ${moved} תיקים הועברו משלבים שהוסרו` : 'עודכנו הגדרות המערכת',
  });
  return mergeConfig(next);
}

/** How many cases sit in each stage, and how many clients / cases filled each added field — for the Settings editors. */
export async function configUsage() {
  const [stages, clientKeys, caseKeys] = await Promise.all([
    sql('SELECT stage, count(*)::int AS n FROM cases GROUP BY stage'),
    sql('SELECT key, count(*)::int AS n FROM clients, jsonb_object_keys(extra) AS key GROUP BY key'),
    sql('SELECT key, count(*)::int AS n FROM cases, jsonb_object_keys(extra) AS key GROUP BY key'),
  ]);
  const toMap = (rows: Row[], k: string) => Object.fromEntries(rows.map((r) => [r[k], r.n as number]));
  return { stages: toMap(stages, 'stage'), clientFields: toMap(clientKeys, 'key'), caseFields: toMap(caseKeys, 'key') };
}

/** Resolve a checklist-template label from config, falling back to the built-in list. */
function templateLabel(config: AppConfig, code: string): string | undefined {
  return (
    config.documentTemplates.find((t) => t.code === code)?.label ??
    documentTemplates.find((t) => t.code === code)?.label
  );
}

export async function saveBlankContract(input: { originalName: string; mimeType: string; buffer: Buffer }) {
  const settings = await getSettings();
  const previous = settings.blankContract;
  const extension = path.extname(path.basename(input.originalName)).replace(/[^.\w]/g, '');
  const safeName = `blank-contract-${Date.now()}${extension}`;
  fs.mkdirSync(templatesFolder(), { recursive: true });
  fs.writeFileSync(path.join(templatesFolder(), safeName), input.buffer);
  settings.blankContract = {
    fileName: safeName,
    originalName: path.basename(input.originalName),
    mimeType: input.mimeType || 'application/octet-stream',
    uploadedAt: nowIso(),
  };
  await saveSettings(settings);
  // Remove the previous template file only once the new one is recorded.
  if (previous) {
    const oldPath = path.join(templatesFolder(), path.basename(previous.fileName));
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  await logActivity({ type: 'settings-updated', summary: 'הועלה טופס חוזה שכירות ריק חדש' });
  return settings.blankContract;
}

export async function readBlankContract() {
  const settings = await getSettings();
  if (!settings.blankContract) return undefined;
  const filePath = path.join(templatesFolder(), path.basename(settings.blankContract.fileName));
  if (!fs.existsSync(filePath)) return undefined;
  return { meta: settings.blankContract, buffer: fs.readFileSync(filePath) };
}

export async function deleteBlankContract() {
  const settings = await getSettings();
  if (!settings.blankContract) return false;
  const filePath = path.join(templatesFolder(), path.basename(settings.blankContract.fileName));
  delete settings.blankContract;
  await saveSettings(settings);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  return true;
}
