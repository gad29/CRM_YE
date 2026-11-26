// The tools an AI bot gets through /api/mcp (Model Context Protocol). Each
// one is a thin wrapper over the same HTTP API the screens use, called with
// the bot's own key, so every permission check, validation and activity-log
// line is exactly the one a person gets in the browser. Answers are trimmed
// to what a bot needs, to keep them short.
import { env } from '@/lib/env';
import {
  CASE_KIND_LABELS,
  CHECKLIST_STATUS_LABELS,
  DECISION_LABELS,
  INVESTIGATION_OUTCOME_LABELS,
  PAYMENT_METHOD_LABELS,
  stageLabelOf,
  type AppConfig,
  type ChecklistItem,
  type ClientRecord,
  type DocumentRecord,
  type TaskRecord,
} from '@/lib/domain';

export class ToolError extends Error {}

export interface ToolContext {
  /** The caller's "Bearer <key>" header, passed on to every API call. */
  authorization: string;
  ip?: string;
  canWrite: boolean;
  isAdmin: boolean;
  you: { name: string; role: string; keyName: string };
  config?: AppConfig;
}

export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; mimeType: string; blob: string } };

type JsonSchema = Record<string, unknown>;

/** Marks a tool's answer as ready-made MCP content (an image, a file), not data to send as JSON. */
class Content {
  constructor(readonly items: ToolContent[]) {}
}

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  /** Changes data: offered only to keys with write access. */
  write?: boolean;
  /** Payments and the activity log are for managers' keys only. */
  adminOnly?: boolean;
  /** Reaches outside the system (sends the client a message). */
  external?: boolean;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

// ── Calling our own API ─────────────────────────────────────────────────────

function baseUrl() {
  return `http://127.0.0.1:${process.env.PORT || 3000}`;
}

async function call(ctx: ToolContext, method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { authorization: ctx.authorization };
  if (ctx.ip) headers[env.clientIpHeader] = ctx.ip;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  return fetch(`${baseUrl()}${path}`, { method, headers, body: payload, cache: 'no-store', signal: AbortSignal.timeout(60_000) });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api<T = any>(ctx: ToolContext, method: string, path: string, body?: unknown): Promise<T> {
  const res = await call(ctx, method, path, body);
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; data?: T };
  if (!res.ok || data.ok === false) {
    if (res.status === 401) throw new ToolError(data.error || 'המפתח נדחה (לא תקין, בוטל, או לקריאה בלבד)');
    if (res.status === 403) throw new ToolError(data.error || 'אין הרשאה לפעולה הזו');
    if (res.status === 404) throw new ToolError(data.error || 'לא נמצא');
    throw new ToolError(data.error || `השרת החזיר ${res.status}`);
  }
  return data.data as T;
}

async function config(ctx: ToolContext) {
  ctx.config ??= await api<AppConfig>(ctx, 'GET', '/api/config');
  return ctx.config;
}

const enc = encodeURIComponent;

// ── Argument helpers ────────────────────────────────────────────────────────

function str(args: Record<string, unknown>, key: string, required = false) {
  const value = args[key];
  if (value === undefined || value === null || value === '') {
    if (required) throw new ToolError(`חסר הפרמטר ${key}`);
    return undefined;
  }
  return String(value);
}

function num(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ToolError(`${key} חייב להיות מספר`);
  return n;
}

/** Only the listed keys that were actually sent. */
function pick(args: Record<string, unknown>, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (args[key] !== undefined) out[key] = args[key];
  return out;
}

function limitOf(args: Record<string, unknown>, fallback: number, max = 200) {
  return Math.min(Math.max(1, Math.floor(num(args, 'limit') ?? fallback)), max);
}

/** Loose match for Hebrew names, phone numbers and ID numbers. */
function matches(query: string, values: (string | undefined)[]) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  return values.some((v) => {
    if (!v) return false;
    const s = v.toLowerCase();
    if (s.includes(q)) return true;
    return digits.length >= 4 && s.replace(/\D/g, '').includes(digits);
  });
}

// ── Trimmed shapes ──────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function caseSummary(c: any, cfg: AppConfig) {
  return {
    id: c.id,
    title: c.title,
    clientId: c.clientId,
    clientName: c.clientName || undefined,
    stage: c.stage,
    stageLabel: stageLabelOf(cfg, c.stage),
    company: c.company ? cfg.companies.find((co) => co.value === c.company)?.label ?? c.company : undefined,
    caseKind: c.caseKind ? CASE_KIND_LABELS[c.caseKind as keyof typeof CASE_KIND_LABELS] ?? c.caseKind : undefined,
    office: c.officeName || undefined,
    referenceNumber: c.referenceNumber || undefined,
    nextAction: c.nextAction || undefined,
    flagged: c.troubleFlag ? c.troubleNote || true : undefined,
    missingDocuments: c.missingItems || undefined,
    fee: c.finance?.fee ?? c.fee,
    balance: c.finance?.balance,
    paymentStatus: c.finance?.status,
    handler: c.assignedToName || c.openedByName || undefined,
    openedAt: c.openedAt,
    updatedAt: c.updatedAt,
  };
}

function checklistRow(item: ChecklistItem) {
  return {
    code: item.code,
    label: item.label,
    status: item.status,
    statusLabel: CHECKLIST_STATUS_LABELS[item.status] ?? item.status,
    note: item.note || undefined,
    documentIds: item.documentIds.length ? item.documentIds : undefined,
  };
}

function documentRow(d: DocumentRecord) {
  return { id: d.id, name: d.originalName, label: d.label && d.label !== d.originalName ? d.label : undefined, caseId: d.caseId, type: d.mimeType, size: d.size, uploadedAt: d.uploadedAt };
}

function clientRow(c: ClientRecord & Record<string, any>) {
  return {
    id: c.id,
    fullName: c.fullName,
    phone: c.phone || undefined,
    idNumber: c.idNumber || undefined,
    email: c.email || undefined,
    city: c.city || undefined,
    openCases: c.openCaseCount,
    cases: c.caseCount,
    missingDocuments: c.missingItems || undefined,
    flagged: c.hasTrouble || undefined,
    balance: c.outstandingBalance || undefined,
  };
}

function taskRow(t: TaskRecord & Record<string, any>) {
  return {
    id: t.id,
    title: t.title,
    notes: t.notes || undefined,
    status: t.status,
    priority: t.priority,
    dueAt: t.dueAt,
    remindAt: t.remindAt,
    assignee: t.assigneeName || t.assigneeId,
    clientId: t.clientId,
    clientName: t.clientName || undefined,
    caseId: t.caseId,
    caseTitle: t.caseTitle || undefined,
    closedBecause: t.resolvedReason || undefined,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
};

// ── The tools ───────────────────────────────────────────────────────────────

const clientFieldsSchema = {
  fullName: { type: 'string', description: 'Full name (Hebrew)' },
  phone: { type: 'string' },
  idNumber: { type: 'string', description: 'Israeli ID number (ת.ז.)' },
  email: { type: 'string' },
  address: { type: 'string' },
  city: { type: 'string' },
  notes: { type: 'string' },
  extra: { type: 'object', description: 'Values for fields added in Settings, by field key (see get_setup clientFields)', additionalProperties: { type: 'string' } },
};

const caseFieldsSchema = {
  title: { type: 'string' },
  company: { type: 'string', description: 'Company value from get_setup companies' },
  caseKind: { type: 'string', enum: ['new', 'renewal'] },
  office: { type: 'string', description: 'Office value from get_setup offices' },
  fee: { type: 'number', description: 'Agreed fee in ILS' },
  referenceNumber: { type: 'string' },
  description: { type: 'string' },
  extra: { type: 'object', description: 'Values for case fields added in Settings, by field key (see get_setup caseFields)', additionalProperties: { type: 'string' } },
};

export const TOOLS: ToolDef[] = [
  {
    name: 'get_setup',
    title: 'הגדרות המערכת',
    description:
      'Call this first. Returns who you are acting as, the case stages in order (code + Hebrew label), client and case fields (which are required), companies, offices, document checklist templates, payment methods and status names. Use the codes from here in other tools.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_args, ctx) => {
      const cfg = await config(ctx);
      return {
        actingAs: ctx.you,
        canChangeData: ctx.canWrite,
        businessName: cfg.businessName,
        stages: cfg.stages.map((s) => ({ code: s.code, label: s.label, phase: s.phase, hidden: s.hidden || undefined, hint: s.hint || undefined })),
        phases: cfg.phases,
        clientFields: cfg.clientFields.filter((f) => f.visible).map((f) => ({ key: f.key, label: f.label, type: f.type, need: f.need, options: f.options })),
        caseFields: cfg.caseFields.filter((f) => f.visible).map((f) => ({ key: f.key, label: f.label, type: f.type, need: f.need, options: f.options })),
        companies: cfg.companies.map((c) => ({ value: c.value, label: c.label })),
        offices: cfg.offices.map((o) => ({ value: o.value, label: o.label })),
        documentTemplates: cfg.documentTemplates.map((t) => ({ code: t.code, label: t.label })),
        paymentMethods: [...Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label })), ...cfg.paymentMethods.map((m) => ({ value: m.value, label: m.label }))],
        checklistStatuses: CHECKLIST_STATUS_LABELS,
        caseKinds: CASE_KIND_LABELS,
        decisionStatuses: DECISION_LABELS,
        investigationOutcomes: INVESTIGATION_OUTCOME_LABELS,
      };
    },
  },
  {
    name: 'search_clients',
    title: 'חיפוש לקוחות',
    description: 'Find clients by name, phone, ID number, email or city (partial matches work; empty query lists the most recent). Returns ids and counts; use get_client for details.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number', description: 'Default 25, max 200' } },
    },
    run: async (args, ctx) => {
      const query = str(args, 'query') ?? '';
      const all = await api<(ClientRecord & Record<string, unknown>)[]>(ctx, 'GET', '/api/clients');
      const found = all.filter((c) => matches(query, [c.fullName, c.phone, c.idNumber, c.email, c.city]));
      return { total: found.length, clients: found.slice(0, limitOf(args, 25)).map(clientRow) };
    },
  },
  {
    name: 'get_client',
    title: 'כרטיס לקוח',
    description: "A client's full details with their cases, documents, payments (managers only) and recent activity.",
    inputSchema: { type: 'object', properties: { clientId: { type: 'string' } }, required: ['clientId'] },
    run: async (args, ctx) => {
      const cfg = await config(ctx);
      const data = await api(ctx, 'GET', `/api/clients/${enc(str(args, 'clientId', true)!)}`);
      return {
        client: data.client,
        cases: data.cases.map((c: unknown) => caseSummary(c, cfg)),
        documents: data.documents.map(documentRow),
        payments: data.canManagePayments ? data.payments : undefined,
        recentActivity: data.activity.slice(0, 15).map((a: { at: string; summary: string }) => ({ at: a.at, summary: a.summary })),
      };
    },
  },
  {
    name: 'list_cases',
    title: 'רשימת תיקים',
    description: 'List cases, newest activity first. Filter by stage code (from get_setup), free text (client name, title, reference number), open only, or flagged only.',
    inputSchema: {
      type: 'object',
      properties: {
        stage: { type: 'string', description: 'Stage code' },
        query: { type: 'string' },
        openOnly: { type: 'boolean', description: 'Default true: leave out closed cases' },
        flaggedOnly: { type: 'boolean' },
        missingDocumentsOnly: { type: 'boolean' },
        limit: { type: 'number', description: 'Default 50, max 200' },
      },
    },
    run: async (args, ctx) => {
      const cfg = await config(ctx);
      const stage = str(args, 'stage');
      const query = str(args, 'query') ?? '';
      const openOnly = args.openOnly !== false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const all = await api<any[]>(ctx, 'GET', '/api/cases');
      const found = all
        .filter((c) => (!stage || c.stage === stage) && (!openOnly || c.stage !== 'closed') && (!args.flaggedOnly || c.troubleFlag) && (!args.missingDocumentsOnly || c.missingItems > 0))
        .filter((c) => matches(query, [c.clientName, c.title, c.referenceNumber, c.clientPhone]))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return { total: found.length, cases: found.slice(0, limitOf(args, 50)).map((c) => caseSummary(c, cfg)) };
    },
  },
  {
    name: 'get_case',
    title: 'פרטי תיק',
    description: "A case with its document checklist (each item's code and status), documents, payments (managers only), recent activity, and who it can be transferred to.",
    inputSchema: { type: 'object', properties: { caseId: { type: 'string' } }, required: ['caseId'] },
    run: async (args, ctx) => {
      const cfg = await config(ctx);
      const data = await api(ctx, 'GET', `/api/cases/${enc(str(args, 'caseId', true)!)}`);
      const c = data.case;
      return {
        case: {
          ...caseSummary(c, cfg),
          description: c.description || undefined,
          notes: c.notes || undefined,
          decision: c.decision || undefined,
          decisionStatus: c.decisionStatus,
          investigationOutcome: c.investigationOutcome,
          extra: c.extra && Object.keys(c.extra).length ? c.extra : undefined,
          submittedAt: c.submittedAt,
          decisionAt: c.decisionAt,
          closedAt: c.closedAt,
        },
        client: { id: data.client?.id, fullName: data.client?.fullName, phone: data.client?.phone, email: data.client?.email },
        checklist: c.checklist.map(checklistRow),
        documents: data.documents.map(documentRow),
        payments: data.canManagePayments ? data.payments : undefined,
        recentActivity: data.activity.slice(0, 15).map((a: { at: string; summary: string }) => ({ at: a.at, summary: a.summary })),
        transferTo: { managers: data.managers, workers: data.workers },
      };
    },
  },
  {
    name: 'list_tasks',
    title: 'משימות ותזכורות',
    description: 'Tasks and reminders you can see. Open ones only by default; filter by client or case.',
    inputSchema: {
      type: 'object',
      properties: { openOnly: { type: 'boolean', description: 'Default true' }, clientId: { type: 'string' }, caseId: { type: 'string' }, limit: { type: 'number' } },
    },
    run: async (args, ctx) => {
      const q = new URLSearchParams();
      if (args.openOnly !== false) q.set('open', '1');
      if (str(args, 'clientId')) q.set('clientId', str(args, 'clientId')!);
      if (str(args, 'caseId')) q.set('caseId', str(args, 'caseId')!);
      const tasks = await api<TaskRecord[]>(ctx, 'GET', `/api/tasks?${q}`);
      return { total: tasks.length, tasks: tasks.slice(0, limitOf(args, 100)).map(taskRow) };
    },
  },
  {
    name: 'read_document',
    title: 'קריאת מסמך',
    description: 'Open an uploaded document. Images come back as images, PDFs as an attached file, text as text. Large or other files return only their details.',
    inputSchema: { type: 'object', properties: { documentId: { type: 'string' } }, required: ['documentId'] },
    run: async (args, ctx) => {
      const id = enc(str(args, 'documentId', true)!);
      const meta = await api<DocumentRecord>(ctx, 'GET', `/api/documents/${id}?meta=1`);
      const details = { type: 'text' as const, text: JSON.stringify(documentRow(meta)) };
      const mime = meta.mimeType || '';
      const isText = mime.startsWith('text/') || mime === 'application/json';
      const isImage = mime.startsWith('image/') && mime !== 'image/heic';
      const isPdf = mime === 'application/pdf';
      const cap = isImage ? 4 * 1024 * 1024 : isPdf ? 10 * 1024 * 1024 : 512 * 1024;
      if (!(isText || isImage || isPdf) || meta.size > cap) {
        return new Content([details, { type: 'text', text: 'את הקובץ הזה אי אפשר להחזיר כאן (סוג או גודל). אפשר לפתוח אותו במערכת.' }]);
      }
      const res = await call(ctx, 'GET', `/api/documents/${id}`);
      if (!res.ok) throw new ToolError('הקובץ לא נמצא בשרת');
      const bytes = Buffer.from(await res.arrayBuffer());
      if (isText) return new Content([details, { type: 'text', text: bytes.toString('utf8') }]);
      if (isImage) return new Content([details, { type: 'image', data: bytes.toString('base64'), mimeType: mime }]);
      return new Content([details, { type: 'resource', resource: { uri: `crmye://documents/${meta.id}`, mimeType: mime, blob: bytes.toString('base64') } }]);
    },
  },
  {
    name: 'list_payments',
    title: 'תשלומים',
    description: 'Payments received, newest first, optionally for one client or case.',
    adminOnly: true,
    inputSchema: { type: 'object', properties: { clientId: { type: 'string' }, caseId: { type: 'string' }, limit: { type: 'number' } } },
    run: async (args, ctx) => {
      const clientId = str(args, 'clientId');
      const caseId = str(args, 'caseId');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const all = await api<any[]>(ctx, 'GET', '/api/payments');
      const found = all.filter((p) => (!clientId || p.clientId === clientId) && (!caseId || p.caseId === caseId));
      return { total: found.length, totalAmount: found.reduce((s, p) => s + Number(p.amount), 0), payments: found.slice(0, limitOf(args, 50)) };
    },
  },
  {
    name: 'recent_activity',
    title: 'יומן פעילות',
    description: 'What happened in the office lately (stage changes, uploads, sends, payments), newest first. Optional free-text filter.',
    adminOnly: true,
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', description: 'Default 30' } } },
    run: async (args, ctx) => {
      const q = new URLSearchParams();
      if (str(args, 'query')) q.set('q', str(args, 'query')!);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await api<any>(ctx, 'GET', `/api/activity?${q}`);
      const rows = Array.isArray(data) ? data : data?.items ?? [];
      return rows.slice(0, limitOf(args, 30)).map((a: { at: string; summary: string; clientName?: string }) => ({ at: a.at, summary: a.summary, client: a.clientName || undefined }));
    },
  },

  // ── Changes ──
  {
    name: 'create_client',
    title: 'לקוח חדש',
    description: 'Add a client. Unless createCase is false (or Settings say otherwise) a case is opened with them; pass its details in `case`. Required fields are listed in get_setup.',
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        ...clientFieldsSchema,
        createCase: { type: 'boolean' },
        case: { type: 'object', properties: { ...caseFieldsSchema, checklistCodes: { type: 'array', items: { type: 'string' }, description: 'Document template codes to require' } } },
      },
      required: ['fullName'],
    },
    run: async (args, ctx) => {
      const cfg = await config(ctx);
      const data = await api(ctx, 'POST', '/api/clients', pick(args, ['fullName', 'phone', 'idNumber', 'email', 'address', 'city', 'notes', 'extra', 'createCase', 'case']));
      return { client: data.client, case: data.case ? caseSummary(data.case, cfg) : undefined };
    },
  },
  {
    name: 'update_client',
    title: 'עדכון לקוח',
    description: "Change a client's details. Send only the fields to change; an empty string clears a field.",
    write: true,
    inputSchema: { type: 'object', properties: { clientId: { type: 'string' }, ...clientFieldsSchema }, required: ['clientId'] },
    run: async (args, ctx) =>
      api(ctx, 'PATCH', `/api/clients/${enc(str(args, 'clientId', true)!)}`, pick(args, ['fullName', 'phone', 'idNumber', 'email', 'address', 'city', 'notes', 'extra'])),
  },
  {
    name: 'create_case',
    title: 'תיק חדש',
    description: 'Open a new case for an existing client.',
    write: true,
    inputSchema: {
      type: 'object',
      properties: { clientId: { type: 'string' }, ...caseFieldsSchema, nextAction: { type: 'string' }, checklistCodes: { type: 'array', items: { type: 'string' } } },
      required: ['clientId', 'title'],
    },
    run: async (args, ctx) => {
      const cfg = await config(ctx);
      const created = await api(ctx, 'POST', '/api/cases', pick(args, ['clientId', 'title', 'company', 'caseKind', 'office', 'fee', 'referenceNumber', 'description', 'extra', 'nextAction', 'checklistCodes']));
      return caseSummary(created, cfg);
    },
  },
  {
    name: 'update_case',
    title: 'עדכון תיק',
    description:
      'Change a case: move it to another stage (stage code from get_setup), set the next action, notes, decision, reference number, flag a problem, or transfer it (assignedTo = a person id from get_case transferTo). Send only what changes.',
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string' },
        stage: { type: 'string' },
        nextAction: { type: 'string' },
        notes: { type: 'string' },
        decision: { type: 'string', description: 'Free-text decision summary' },
        decisionStatus: { type: 'string', enum: ['approved', 'investigation'] },
        investigationOutcome: { type: 'string', enum: ['approved', 'rejected', ''] },
        troubleFlag: { type: 'boolean', description: 'Flag the case as stuck' },
        troubleNote: { type: 'string' },
        assignedTo: { type: 'string' },
        ...caseFieldsSchema,
      },
      required: ['caseId'],
    },
    run: async (args, ctx) => {
      const cfg = await config(ctx);
      const updated = await api(
        ctx,
        'PATCH',
        `/api/cases/${enc(str(args, 'caseId', true)!)}`,
        pick(args, ['stage', 'nextAction', 'notes', 'decision', 'decisionStatus', 'investigationOutcome', 'troubleFlag', 'troubleNote', 'assignedTo', 'title', 'company', 'caseKind', 'office', 'fee', 'referenceNumber', 'description', 'extra']),
      );
      return caseSummary(updated, cfg);
    },
  },
  {
    name: 'set_checklist_item',
    title: 'עדכון מסמך נדרש',
    description: "Set the status or note of one item in a case's document checklist (item code from get_case).",
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string' },
        code: { type: 'string' },
        status: { type: 'string', enum: Object.keys(CHECKLIST_STATUS_LABELS) },
        note: { type: 'string' },
      },
      required: ['caseId', 'code'],
    },
    run: async (args, ctx) => checklistRow(await api(ctx, 'PATCH', `/api/cases/${enc(str(args, 'caseId', true)!)}/checklist`, pick(args, ['code', 'status', 'note']))),
  },
  {
    name: 'add_checklist_item',
    title: 'הוספת מסמך נדרש',
    description: "Add a required document to a case's checklist, by template code (get_setup documentTemplates) or as free text.",
    write: true,
    inputSchema: {
      type: 'object',
      properties: { caseId: { type: 'string' }, code: { type: 'string', description: 'Template code' }, label: { type: 'string', description: 'Free text, when there is no template' } },
      required: ['caseId'],
    },
    run: async (args, ctx) => checklistRow(await api(ctx, 'POST', `/api/cases/${enc(str(args, 'caseId', true)!)}/checklist`, pick(args, ['code', 'label']))),
  },
  {
    name: 'upload_document',
    title: 'העלאת מסמך',
    description:
      "Upload a file to a client's folder, optionally to a case and as a checklist item (which marks it received). Send the file as base64 with its original file name.",
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string' },
        fileName: { type: 'string', description: 'With extension, e.g. "תלוש שכר מרץ.pdf"' },
        contentBase64: { type: 'string' },
        caseId: { type: 'string' },
        checklistCode: { type: 'string' },
        label: { type: 'string', description: 'Display name, if different from the file name' },
      },
      required: ['clientId', 'fileName', 'contentBase64'],
    },
    run: async (args, ctx) => {
      const fileName = str(args, 'fileName', true)!.split(/[\\/]/).pop()!;
      const raw = str(args, 'contentBase64', true)!.replace(/^data:[^,]*,/, '');
      const bytes = Buffer.from(raw, 'base64');
      if (!bytes.length) throw new ToolError('הקובץ ריק או שאינו base64 תקין');
      const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: MIME_BY_EXT[ext] || 'application/octet-stream' }), fileName);
      if (str(args, 'caseId')) form.append('caseId', str(args, 'caseId')!);
      if (str(args, 'checklistCode')) form.append('checklistCode', str(args, 'checklistCode')!);
      if (str(args, 'label')) form.append('label', str(args, 'label')!);
      const saved = await api<DocumentRecord[]>(ctx, 'POST', `/api/clients/${enc(str(args, 'clientId', true)!)}/documents`, form);
      return saved.map(documentRow);
    },
  },
  {
    name: 'send_documents',
    title: 'שליחת מסמכים ללקוח',
    description:
      "Send documents to their client (all must belong to the same client). By email they go as attachments with their original names (or a download link when over ~18 MB); by WhatsApp as a secure link. This really messages the client.",
    write: true,
    external: true,
    inputSchema: {
      type: 'object',
      properties: { documentIds: { type: 'array', items: { type: 'string' } }, channel: { type: 'string', enum: ['email', 'whatsapp'] } },
      required: ['documentIds', 'channel'],
    },
    run: async (args, ctx) => {
      const ids = Array.isArray(args.documentIds) ? args.documentIds.map(String) : [];
      const res = await call(ctx, 'POST', '/api/documents/send', { documentIds: ids, channel: args.channel });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; attached?: boolean };
      if (!res.ok || !data.ok) throw new ToolError(data.error || 'השליחה נכשלה');
      return { sent: true, as: data.attached ? 'attachments' : 'link' };
    },
  },
  {
    name: 'create_task',
    title: 'משימה חדשה',
    description: 'Add a task or reminder, optionally about a client or case. Dates are ISO 8601 (Israel time if no offset).',
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        notes: { type: 'string' },
        dueAt: { type: 'string' },
        remindAt: { type: 'string', description: 'When to send the reminder' },
        priority: { type: 'string', enum: ['normal', 'high', 'urgent'] },
        clientId: { type: 'string' },
        caseId: { type: 'string' },
        assigneeId: { type: 'string', description: 'Managers only; defaults to you' },
      },
      required: ['title'],
    },
    run: async (args, ctx) => taskRow(await api(ctx, 'POST', '/api/tasks', pick(args, ['title', 'notes', 'dueAt', 'remindAt', 'priority', 'clientId', 'caseId', 'assigneeId']))),
  },
  {
    name: 'update_task',
    title: 'עדכון משימה',
    description: 'Mark a task done (status "done") or reopen it, or change its details.',
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        status: { type: 'string', enum: ['open', 'done'] },
        title: { type: 'string' },
        notes: { type: 'string' },
        dueAt: { type: 'string' },
        remindAt: { type: 'string' },
        priority: { type: 'string', enum: ['normal', 'high', 'urgent'] },
      },
      required: ['taskId'],
    },
    run: async (args, ctx) => taskRow(await api(ctx, 'PATCH', `/api/tasks/${enc(str(args, 'taskId', true)!)}`, pick(args, ['status', 'title', 'notes', 'dueAt', 'remindAt', 'priority']))),
  },
  {
    name: 'add_payment',
    title: 'רישום תשלום',
    description: 'Record a payment received from a client, optionally against a case. Method value from get_setup paymentMethods.',
    write: true,
    adminOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string' },
        caseId: { type: 'string' },
        amount: { type: 'number', description: 'ILS' },
        method: { type: 'string' },
        paidAt: { type: 'string', description: 'ISO date; default today' },
        note: { type: 'string' },
      },
      required: ['clientId', 'amount'],
    },
    run: async (args, ctx) => api(ctx, 'POST', '/api/payments', pick(args, ['clientId', 'caseId', 'amount', 'method', 'paidAt', 'note'])),
  },
];

/** The tools this key is offered: no changes for a read-only key, no money or log for a worker's. */
export function toolsFor(ctx: Pick<ToolContext, 'canWrite' | 'isAdmin'>) {
  return TOOLS.filter((t) => (ctx.canWrite || !t.write) && (ctx.isAdmin || !t.adminOnly));
}

export function toolListing(ctx: Pick<ToolContext, 'canWrite' | 'isAdmin'>) {
  return toolsFor(ctx).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: !t.write, destructiveHint: false, idempotentHint: !t.write, openWorldHint: Boolean(t.external) },
  }));
}

/** Run a tool; a refusal or bad input comes back as an error result the bot can read and act on. */
export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext) {
  const tool = toolsFor(ctx).find((t) => t.name === name);
  if (!tool) return { content: [{ type: 'text', text: `אין כלי בשם ${name} למפתח הזה` }], isError: true };
  try {
    const result = await tool.run(args ?? {}, ctx);
    const content: ToolContent[] = result instanceof Content ? result.items : [{ type: 'text', text: JSON.stringify(result ?? null) }];
    return { content, isError: false };
  } catch (error) {
    const message = error instanceof ToolError ? error.message : `שגיאה: ${String((error as Error)?.message || error).slice(0, 300)}`;
    if (!(error instanceof ToolError)) console.error('[CRM_YE mcp]', name, error);
    return { content: [{ type: 'text', text: message }], isError: true };
  }
}

export const MCP_INSTRUCTIONS = `CRM of an Israeli rent-assistance (סיוע בשכר דירה) advisory office. All data is in Hebrew.
Clients have cases; a case moves through stages in order and has a checklist of required documents.
Call get_setup once first: it lists the stages, fields, companies and codes the other tools expect, and whose access you have.
Find people with search_clients or list_cases, then use the ids. Nothing can be deleted through this connection.
send_documents really emails or WhatsApps the client: confirm with the person you work for before sending.`;
