/**
 * CRM_YE domain model.
 *
 * CRM_YE manages the full journey of a client whose advisor prepares and
 * submits applications to Israeli government offices: collecting documents,
 * reviewing them, submitting the case, tracking the office's handling,
 * receiving the decision, closing the case, and collecting payment.
 */

/** The stages the system ships with. Each one carries built-in behaviour (the
 *  "next step" panel, payments, closing); stages added in Settings are plain. */
export type BuiltInStage =
  | 'new-client'
  | 'collecting-documents'
  | 'documents-review'
  | 'ready-for-client'
  | 'sent-to-client'
  | 'submitted'
  | 'in-government-review'
  | 'action-required'
  | 'decision-received'
  | 'awaiting-payment'
  | 'closed';

/** A stage code: a built-in one, or one added in Settings (st-xxxx). */
export type CaseStage = BuiltInStage | (string & {});

export const CASE_STAGES: BuiltInStage[] = [
  'new-client',
  'collecting-documents',
  'documents-review',
  'ready-for-client',
  'sent-to-client',
  'submitted',
  'in-government-review',
  'action-required',
  'decision-received',
  'awaiting-payment',
  'closed',
];

export const STAGE_LABELS: Record<BuiltInStage, string> = {
  'new-client': 'תיק חדש',
  'collecting-documents': 'איסוף מסמכים',
  'documents-review': 'בדיקת מסמכים',
  'ready-for-client': 'מוכן לשליחה ללקוח',
  'sent-to-client': 'נשלח ללקוח לאחר תיקון',
  'submitted': 'הוגש למשרד',
  'in-government-review': 'בטיפול המשרד',
  'action-required': 'נדרשת השלמה',
  'decision-received': 'התקבלה החלטה',
  'awaiting-payment': 'ממתין לתשלום',
  'closed': 'תיק סגור',
};

/** Case is in an open investigation (red state) until an outcome is set. */
export function isUnderInvestigation(caseRecord: {
  decisionStatus?: DecisionStatus;
  investigationOutcome?: InvestigationOutcome;
}) {
  return caseRecord.decisionStatus === 'investigation' && !caseRecord.investigationOutcome;
}

/** Legacy stage codes → current codes (kept for data written by older versions). */
export const LEGACY_STAGE_MAP: Record<string, BuiltInStage> = {
  'ready-to-submit': 'ready-for-client',
};

export type DecisionStatus = 'approved' | 'investigation';
export type InvestigationOutcome = 'approved' | 'rejected';

export const DECISION_LABELS: Record<DecisionStatus, string> = {
  approved: 'אושר',
  investigation: 'חקירה',
};

export const INVESTIGATION_OUTCOME_LABELS: Record<InvestigationOutcome, string> = {
  approved: 'אושר',
  rejected: 'נדחה',
};

/** Stages that count as an open, active case. */
export const OPEN_STAGES: CaseStage[] = CASE_STAGES.filter((s) => s !== 'closed');

export function isBuiltInStage(code: string): code is BuiltInStage {
  return (CASE_STAGES as string[]).includes(code);
}

export type GovernmentOffice =
  | 'bituach-leumi'
  | 'population-authority'
  | 'tax-authority'
  | 'housing-ministry'
  | 'welfare-ministry'
  | 'health-ministry'
  | 'education-ministry'
  | 'transport-ministry'
  | 'aliyah-ministry'
  | 'municipality'
  | 'courts-enforcement'
  | 'other';

export const OFFICE_LABELS: Record<GovernmentOffice, string> = {
  'bituach-leumi': 'המוסד לביטוח לאומי',
  'population-authority': 'רשות האוכלוסין וההגירה (משרד הפנים)',
  'tax-authority': 'רשות המסים',
  'housing-ministry': 'משרד הבינוי והשיכון',
  'welfare-ministry': 'משרד הרווחה והביטחון החברתי',
  'health-ministry': 'משרד הבריאות',
  'education-ministry': 'משרד החינוך',
  'transport-ministry': 'משרד התחבורה',
  'aliyah-ministry': 'משרד העלייה והקליטה',
  'municipality': 'רשות מקומית / עירייה',
  'courts-enforcement': 'בתי משפט / הוצאה לפועל',
  'other': 'אחר',
};

/** Operating company handling the case (e.g. rent-assistance operators). */
export type OperatingCompany = 'milgam' | 'alonim' | 'maof' | 'none';

export const COMPANY_LABELS: Record<OperatingCompany, string> = {
  'milgam': 'מילגם',
  'alonim': 'אלונים',
  'maof': 'מעוף',
  'none': 'ללא / אחר',
};

/** Default colour per operating company — each gets its own, distinct from
 *  the red/green/orange used for status. Editable in Settings. */
export const COMPANY_COLORS: Record<string, string> = {
  milgam: '#7c3aed',
  alonim: '#0d9488',
  maof: '#db2777',
};

export type CaseKind = 'new' | 'renewal';

export const CASE_KIND_LABELS: Record<CaseKind, string> = {
  'new': 'תיק חדש',
  'renewal': 'חידוש',
};

export type ChecklistStatus =
  | 'missing'
  | 'received'
  | 'in-review'
  | 'approved'
  | 'resubmit-needed'
  | 'not-applicable';

export const CHECKLIST_STATUS_LABELS: Record<ChecklistStatus, string> = {
  'missing': 'חסר',
  'received': 'התקבל',
  'in-review': 'בבדיקה',
  'approved': 'אושר',
  'resubmit-needed': 'נדרש מחדש',
  'not-applicable': 'לא רלוונטי',
};

export interface ChecklistItem {
  /** Unique within the case (template code or custom-<n>). */
  code: string;
  label: string;
  status: ChecklistStatus;
  note?: string;
  /** Uploaded document ids fulfilling this requirement. */
  documentIds: string[];
  updatedAt: string;
}

export interface ClientRecord {
  id: string;
  fullName: string;
  idNumber?: string;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  notes?: string;
  /** Values of client fields added in Settings, by field key. */
  extra?: Record<string, string>;
  /** Worker id who created the client; 'admin' or absent for the admin. */
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** Additional admin account (full privileges, stored in the DB). The root admin lives in .env. */
export interface AdminRecord {
  id: string;
  name: string;
  email: string;
  /** Optional, for SMS/WhatsApp password-reset codes (international format). */
  phone?: string;
  passwordHash: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerRecord {
  id: string;
  name: string;
  email: string;
  /** Optional, for WhatsApp reminders (international format, e.g. 9725x…). */
  phone?: string;
  passwordHash: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CaseRecord {
  id: string;
  clientId: string;
  /** Short case title, e.g. "קצבת נכות" or "חידוש דרכון". */
  title: string;
  office: GovernmentOffice;
  /** Free-text office name when office === 'other'. */
  officeOther?: string;
  description?: string;
  stage: CaseStage;
  checklist: ChecklistItem[];
  /** Operating company the case is handled through. */
  company?: OperatingCompany;
  /** New application or renewal. */
  caseKind?: CaseKind;
  /** Red flag: the case is stuck / needs additional information or documents. */
  troubleFlag?: boolean;
  troubleNote?: string;
  /** Worker id who opened the case ('admin' when opened by the admin). */
  openedBy?: string;
  /** Worker id the admin assigned the case to. */
  assignedTo?: string;
  /** Agreed fee in ILS. */
  fee: number;
  /** Reference / file number assigned by the government office. */
  referenceNumber?: string;
  nextAction?: string;
  notes?: string;
  /** Free-text decision summary. */
  decision?: string;
  /** Structured decision: approved directly, or sent to investigation. */
  decisionStatus?: DecisionStatus;
  /** Outcome when decisionStatus === 'investigation'. */
  investigationOutcome?: InvestigationOutcome;
  /** Manual override for the payment status; when unset, status is computed from fee vs payments. */
  paymentStatusOverride?: PaymentStatus;
  /** Values of case fields added in Settings, by field key. */
  extra?: Record<string, string>;
  openedAt: string;
  submittedAt?: string;
  decisionAt?: string;
  closedAt?: string;
  updatedAt: string;
}

export interface DocumentRecord {
  id: string;
  clientId: string;
  /** Optional link to a specific case. */
  caseId?: string;
  /** Stored file name inside the client folder. */
  fileName: string;
  originalName: string;
  /** Human label shown in the UI, defaults to the original name. */
  label?: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  updatedAt: string;
  /** Set when this file was produced by the in-app editor from another document. */
  editedFromId?: string;
}

export type PaymentMethod =
  | 'cash'
  | 'bank-transfer'
  | 'bit'
  | 'paybox'
  | 'check'
  | 'credit-card'
  | 'other';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  'cash': 'מזומן',
  'bank-transfer': 'העברה בנקאית',
  'bit': 'ביט',
  'paybox': 'פייבוקס',
  'check': "צ'ק",
  'credit-card': 'כרטיס אשראי',
  'other': 'אחר',
};

export interface PaymentRecord {
  id: string;
  clientId: string;
  caseId?: string;
  amount: number;
  method: PaymentMethod;
  paidAt: string;
  note?: string;
  createdAt: string;
}

export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: 'לא שולם',
  partial: 'שולם חלקית',
  paid: 'שולם',
};

// ── Tasks & reminders ────────────────────────────────────────────────────────

export type TaskPriority = 'normal' | 'high' | 'urgent';

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  normal: 'רגיל',
  high: 'חשוב',
  urgent: 'דחוף',
};

export type ReminderChannel = 'email' | 'whatsapp';

export const REMINDER_CHANNEL_LABELS: Record<ReminderChannel, string> = {
  email: 'אימייל',
  whatsapp: 'וואטסאפ',
};

export interface TaskRecord {
  id: string;
  title: string;
  notes?: string;
  /** When the task is due (ISO datetime). */
  dueAt?: string;
  /** When to send the reminder (ISO datetime). */
  remindAt?: string;
  reminderChannels: ReminderChannel[];
  /** Set once the reminder was sent (prevents double sends). */
  reminderSentAt?: string;
  priority: TaskPriority;
  /** 'admin' or a worker id. */
  assigneeId: string;
  clientId?: string;
  caseId?: string;
  status: 'open' | 'done';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  /** What gap this reminder watches; it closes itself once the gap is filled. */
  watchKind?: TaskWatchKind;
  /** checklist-item: the item code · client-details: comma-separated field names. */
  watchRef?: string;
  /** Set when the reminder closed itself: why (e.g. "המסמך התקבל"). */
  resolvedReason?: string;
}

export type TaskWatchKind = 'checklist-item' | 'case-documents' | 'case-payment' | 'client-details';

export const TASK_WATCH_KINDS: TaskWatchKind[] = ['checklist-item', 'case-documents', 'case-payment', 'client-details'];

/** Client details whose absence can be watched (the built-in ones; fields added in Settings too). */
export const CLIENT_DETAIL_LABELS = {
  phone: 'טלפון',
  idNumber: 'תעודת זהות',
  email: 'אימייל',
  address: 'כתובת',
  city: 'עיר',
} as const;

/** A client detail key: a built-in column or a field added in Settings (f-xxxx). */
export type ClientDetailField = string;

/** The client's value for a field, built-in column or Settings-added. */
export function fieldValue(record: { extra?: Record<string, string> }, key: string): string {
  const own = (record as unknown as Record<string, unknown>)[key];
  if (typeof own === 'string') return own;
  if (typeof own === 'number') return String(own);
  return record.extra?.[key] ?? '';
}

/** Keys of the details marked "needed" in Settings that this client is missing. */
export function missingClientDetails(
  client: { extra?: Record<string, string> },
  fields: FieldDef[] = DEFAULT_CLIENT_FIELDS,
): ClientDetailField[] {
  return fields.filter((f) => fieldNeeded(f) && !fieldValue(client, f.key).trim()).map((f) => f.key);
}

/** "Closes by itself when …" — shown on the reminder. */
export function watchHint(kind: TaskWatchKind) {
  switch (kind) {
    case 'checklist-item':
      return 'נסגרת מעצמה כשהמסמך מתקבל';
    case 'case-documents':
      return 'נסגרת מעצמה כשכל המסמכים מתקבלים';
    case 'case-payment':
      return 'נסגרת מעצמה כשהתשלום מתקבל';
    case 'client-details':
      return 'נסגרת מעצמה כשהפרטים מושלמים';
  }
}

// ── Team chat ────────────────────────────────────────────────────────────────

export type ChatChannelKind = 'public' | 'direct';

export interface ChatChannel {
  id: string;
  kind: ChatChannelKind;
  /** Display name (public channels); DMs are named after the other member. */
  name: string;
  /** Exactly two member ids for a DM; empty for public (everyone). */
  memberIds: string[];
  createdAt: string;
  /** Bumped on every message so conversations sort by recency. */
  updatedAt: string;
}

export type ChatAttachmentKind = 'file' | 'image' | 'voice';

export interface ChatAttachment {
  id: string;
  /** Stored file name inside the channel folder. */
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  kind: ChatAttachmentKind;
  /** Voice notes only. */
  durationSec?: number;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  /** 'admin' (root), ADM-x or WRK-x. */
  authorId: string;
  authorName: string;
  body?: string;
  attachments: ChatAttachment[];
  /** Set when the message carries a reminder (links to the task it created). */
  reminderTaskId?: string;
  reminderAt?: string;
  reminderChannels?: ReminderChannel[];
  /** Member ids that have read the message (the author counts as read). */
  readBy: string[];
  createdAt: string;
  deletedAt?: string;
}

/** A person who can take part in the chat (admin or worker). */
export interface ChatMember {
  id: string;
  name: string;
  role: 'admin' | 'worker';
  email?: string;
  phone?: string;
  active: boolean;
}

export const PUBLIC_CHANNEL_ID = 'public-general';

export interface ActivityRecord {
  id: string;
  type: string;
  clientId?: string;
  caseId?: string;
  summary: string;
  at: string;
}

/**
 * Reusable document requirements. Selected items seed a new case's checklist;
 * the admin can always add custom items per case.
 */
export interface DocumentTemplate {
  code: string;
  label: string;
  /** When set, the template is suggested first for these offices. */
  offices?: GovernmentOffice[];
}

export const documentTemplates: DocumentTemplate[] = [
  { code: 'id-spouses', label: 'תעודת זהות וספח — שני בני הזוג' },
  { code: 'payslips-6m', label: 'תלושי שכר — 6 חודשים אחרונים' },
  { code: 'non-working-status', label: 'אישור מעמד לא עובד' },
  { code: 'kollel-confirmation', label: 'אישור כולל' },
  { code: 'marriage-certificate', label: 'תעודת נישואין' },
  { code: 'employer-letter', label: 'מכתב מעסיק / אישור העסקה' },
  { code: 'request-letter', label: 'מכתב בקשה' },
  { code: 'bank-statements', label: 'עובר ושב' },
  { code: 'rent-contract', label: 'חוזה שכירות' },
];

/** Codes seeded into every new case's checklist (rent contract included — a blank
 *  template uploaded once in Settings is downloadable from every case). */
export const DEFAULT_CHECKLIST_CODES = documentTemplates.map((t) => t.code);

export const BLANK_CONTRACT_CODE = 'rent-contract';

/** Checklist statuses that still block submission. */
export function checklistItemIsMissing(item: ChecklistItem) {
  return item.status === 'missing' || item.status === 'resubmit-needed';
}

export function countMissingItems(caseRecord: Pick<CaseRecord, 'checklist'>) {
  return caseRecord.checklist.filter(checklistItemIsMissing).length;
}

export function officeDisplayName(caseRecord: Pick<CaseRecord, 'office' | 'officeOther'>) {
  if (caseRecord.office === 'other' && caseRecord.officeOther?.trim()) {
    return caseRecord.officeOther.trim();
  }
  return OFFICE_LABELS[caseRecord.office];
}

// ── Runtime configuration (editable in Settings, no code change needed) ──────

export interface ConfigOption {
  value: string;
  label: string;
  /** Display colour (#rrggbb) — used for operating companies. */
  color?: string;
}

// ── Stages, phases and trays (editable in Settings) ─────────────────────────

/** The four groups the journey bar shows; their names are editable. */
export type PhaseId = 'intake' | 'submit' | 'office' | 'finish';
export const PHASE_IDS: PhaseId[] = ['intake', 'submit', 'office', 'finish'];

export interface PhaseDef {
  id: PhaseId;
  label: string;
}

/** Today-screen trays a stage can feed ("missing" and "flagged" follow the data, not the stage). */
export type StageTray = 'ready' | 'office' | 'payment';

export interface StageDef {
  /** A built-in code, or st-xxxx for a stage added in Settings. */
  code: CaseStage;
  label: string;
  phase: PhaseId;
  /** Hidden stages are skipped: buttons that would move a case there move it to the next shown stage. */
  hidden?: boolean;
  /** What to do in this stage — shown in the "next step" panel. */
  hint?: string;
  tray?: StageTray;
}

export const DEFAULT_PHASES: PhaseDef[] = [
  { id: 'intake', label: 'קליטה ומסמכים' },
  { id: 'submit', label: 'הכנה והגשה' },
  { id: 'office', label: 'בטיפול המשרד' },
  { id: 'finish', label: 'תשלום וסגירה' },
];

const DEFAULT_STAGE_PHASE: Record<BuiltInStage, PhaseId> = {
  'new-client': 'intake',
  'collecting-documents': 'intake',
  'documents-review': 'intake',
  'ready-for-client': 'submit',
  'sent-to-client': 'submit',
  'submitted': 'submit',
  'in-government-review': 'office',
  'action-required': 'office',
  'decision-received': 'office',
  'awaiting-payment': 'finish',
  'closed': 'finish',
};

const DEFAULT_STAGE_TRAY: Partial<Record<BuiltInStage, StageTray>> = {
  'ready-for-client': 'ready',
  'sent-to-client': 'ready',
  'submitted': 'office',
  'in-government-review': 'office',
  'awaiting-payment': 'payment',
};

export const DEFAULT_STAGES: StageDef[] = CASE_STAGES.map((code) => ({
  code,
  label: STAGE_LABELS[code],
  phase: DEFAULT_STAGE_PHASE[code],
  ...(DEFAULT_STAGE_TRAY[code] ? { tray: DEFAULT_STAGE_TRAY[code] } : {}),
}));

export type TrayId = 'missing' | 'ready' | 'office' | 'payment' | 'flagged';

export interface TrayDef {
  id: TrayId;
  label: string;
  hint: string;
  hidden?: boolean;
}

export const DEFAULT_TRAYS: TrayDef[] = [
  { id: 'missing', label: 'מסמכים חסרים', hint: 'לבקש מהלקוחות' },
  { id: 'ready', label: 'מוכן להגשה', hint: 'לשלוח ללקוח או להגיש' },
  { id: 'office', label: 'ממתין למשרד', hint: 'הוגש, מחכים לתשובה' },
  { id: 'payment', label: 'ממתין לתשלום', hint: 'לגבות שכר טרחה' },
  { id: 'flagged', label: 'מסומנים', hint: 'תקועים או בבירור' },
];

// ── Client and case fields (editable in Settings) ───────────────────────────

export type FieldType = 'text' | 'longtext' | 'phone' | 'email' | 'number' | 'date' | 'select' | 'yesno';

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'טקסט',
  longtext: 'טקסט ארוך',
  phone: 'טלפון',
  email: 'אימייל',
  number: 'מספר',
  date: 'תאריך',
  select: 'בחירה מרשימה',
  yesno: 'כן / לא',
};

/** optional: nice to have · needed: shown as missing until filled · required: can't save without it. */
export type FieldNeed = 'optional' | 'needed' | 'required';

export const FIELD_NEED_LABELS: Record<FieldNeed, string> = {
  optional: 'רשות',
  needed: 'נדרש להשלמה',
  required: 'חובה',
};

export interface FieldDef {
  /** Built-in column name, or f-xxxx for a field added in Settings (stored in `extra`). */
  key: string;
  label: string;
  type: FieldType;
  /** Choices for a 'select' field added in Settings. */
  options?: string[];
  visible: boolean;
  need: FieldNeed;
  builtIn?: boolean;
  /** Shown on the client card in lists / in the case header. */
  inList?: boolean;
  placeholder?: string;
}

/** True when the field must be filled or is tracked as missing. */
export function fieldNeeded(f: Pick<FieldDef, 'need' | 'visible'>) {
  return f.visible && f.need !== 'optional';
}

export const DEFAULT_CLIENT_FIELDS: FieldDef[] = [
  { key: 'phone', label: 'טלפון', type: 'phone', visible: true, need: 'required', builtIn: true, inList: true },
  { key: 'idNumber', label: 'תעודת זהות', type: 'text', visible: true, need: 'needed', builtIn: true, inList: true },
  { key: 'email', label: 'אימייל', type: 'email', visible: true, need: 'needed', builtIn: true },
  { key: 'address', label: 'כתובת', type: 'text', visible: true, need: 'needed', builtIn: true },
  { key: 'city', label: 'עיר', type: 'text', visible: true, need: 'needed', builtIn: true, inList: true },
  { key: 'notes', label: 'הערות', type: 'longtext', visible: true, need: 'optional', builtIn: true },
];

/** Case fields; office / company / caseKind take their choices from the lists in Settings. */
export const DEFAULT_CASE_FIELDS: FieldDef[] = [
  { key: 'company', label: 'חברה מטפלת', type: 'select', visible: true, need: 'required', builtIn: true, inList: true },
  { key: 'caseKind', label: 'סוג התיק', type: 'select', visible: true, need: 'optional', builtIn: true },
  { key: 'office', label: 'משרד', type: 'select', visible: true, need: 'optional', builtIn: true, inList: true },
  { key: 'fee', label: 'שכר טרחה', type: 'number', visible: true, need: 'optional', builtIn: true },
  { key: 'referenceNumber', label: 'מספר תיק במשרד', type: 'text', visible: true, need: 'optional', builtIn: true },
  { key: 'description', label: 'תיאור', type: 'longtext', visible: true, need: 'optional', builtIn: true },
];

export const BUILT_IN_CLIENT_FIELD_KEYS = DEFAULT_CLIENT_FIELDS.map((f) => f.key);
export const BUILT_IN_CASE_FIELD_KEYS = DEFAULT_CASE_FIELDS.map((f) => f.key);

/** Areas of the system that can be switched off when not used. */
export interface ModuleSwitches {
  tasks: boolean;
  chat: boolean;
  payments: boolean;
}

/**
 * Everything an admin can edit at runtime from the Settings page.
 * Defaults come from the constants above; saved overrides are merged on top.
 */
export interface AppConfig {
  /** Branding shown in the sidebar and browser tab. */
  businessName: string;
  sidebarSubtitle: string;
  /** Defaults used when opening a new case. */
  defaultCaseTitle: string;
  defaultFee: number;
  /** When true, creating a client also opens a case automatically. */
  autoCreateCaseOnClient: boolean;
  /** When true, new cases start pre-loaded with the document checklist. */
  seedChecklistByDefault: boolean;
  companies: ConfigOption[];
  documentTemplates: { code: string; label: string }[];
  paymentMethods: ConfigOption[];
  offices: ConfigOption[];
  /** The pipeline, in order (grouped by phase). 'closed' is always last. */
  stages: StageDef[];
  phases: PhaseDef[];
  trays: TrayDef[];
  clientFields: FieldDef[];
  caseFields: FieldDef[];
  modules: ModuleSwitches;
  /** Overrides for on-screen wording, by key (see lib/texts.ts). */
  texts: Record<string, string>;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  businessName: 'CRM_YE',
  sidebarSubtitle: 'ליווי תיקים מול משרדי ממשלה',
  defaultCaseTitle: 'סיוע בשכר דירה',
  defaultFee: 0,
  autoCreateCaseOnClient: true,
  seedChecklistByDefault: true,
  companies: Object.entries(COMPANY_LABELS).map(([value, label]) =>
    COMPANY_COLORS[value] ? { value, label, color: COMPANY_COLORS[value] } : { value, label },
  ),
  documentTemplates: documentTemplates.map((t) => ({ code: t.code, label: t.label })),
  paymentMethods: Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label })),
  offices: Object.entries(OFFICE_LABELS).map(([value, label]) => ({ value, label })),
  stages: DEFAULT_STAGES,
  phases: DEFAULT_PHASES,
  trays: DEFAULT_TRAYS,
  clientFields: DEFAULT_CLIENT_FIELDS,
  caseFields: DEFAULT_CASE_FIELDS,
  modules: { tasks: true, chat: true, payments: true },
  texts: {},
};

/** Look up a label in a config option list, falling back to the raw value. */
export function optionLabel(options: ConfigOption[] | undefined, value?: string, fallback = '—') {
  if (!value) return fallback;
  return options?.find((o) => o.value === value)?.label ?? value;
}

type StageConfig = Partial<Pick<AppConfig, 'stages' | 'phases'>> | undefined;

/** Every stage in pipeline order, shown and hidden. */
export function stageDefs(config: StageConfig): StageDef[] {
  return config?.stages?.length ? config.stages : DEFAULT_STAGES;
}

export function stageDef(config: StageConfig, code: string): StageDef | undefined {
  return stageDefs(config).find((s) => s.code === code);
}

/** Position in the pipeline (-1 for an unknown code). */
export function stageOrder(config: StageConfig, code: string) {
  return stageDefs(config).findIndex((s) => s.code === code);
}

/** Stage label from config, falling back to the built-in Hebrew label. */
export function stageLabelOf(config: StageConfig, stage: string) {
  return stageDef(config, stage)?.label ?? STAGE_LABELS[stage as BuiltInStage] ?? stage;
}

/** The next shown stage after `from` (undefined at the end). */
export function nextStage(config: StageConfig, from: string): CaseStage | undefined {
  const list = stageDefs(config);
  const at = list.findIndex((s) => s.code === from);
  return list.slice(at + 1).find((s) => !s.hidden)?.code;
}

/** Where a move to `target` really lands: the stage itself, or the next shown one if it is hidden. */
export function resolveStage(config: StageConfig, target: CaseStage): CaseStage {
  const def = stageDef(config, target);
  if (def && !def.hidden) return target;
  return (def && nextStage(config, target)) || 'closed';
}

/** Phases with their shown stages (plus `current` even if hidden, so a case never drops off its bar). */
export function phaseGroups(config: StageConfig, current?: string) {
  const phases = config?.phases?.length ? config.phases : DEFAULT_PHASES;
  const stages = stageDefs(config);
  return phases.map((p) => ({ ...p, stages: stages.filter((s) => s.phase === p.id && (!s.hidden || s.code === current)) }));
}

export function phaseOfStage(config: StageConfig, code: string): PhaseId {
  return stageDef(config, code)?.phase ?? DEFAULT_STAGE_PHASE[code as BuiltInStage] ?? 'intake';
}

export function stageTray(config: StageConfig, code: string): StageTray | undefined {
  return stageDef(config, code)?.tray;
}

/** Colour of an operating company: the one set in Settings, else the built-in default. */
export function companyColor(config: Pick<AppConfig, 'companies'> | undefined, company?: string) {
  if (!company || company === 'none') return undefined;
  return config?.companies?.find((c) => c.value === company)?.color || COMPANY_COLORS[company];
}

/**
 * Who currently handles a case: whoever it was last transferred to, else whoever
 * opened it. 'admin' is the manager. Workers see exactly the cases they handle.
 */
export function caseHandlerId(caseRecord: Pick<CaseRecord, 'assignedTo' | 'openedBy'>) {
  return caseRecord.assignedTo || caseRecord.openedBy || 'admin';
}

/** True for a manager id: the root admin ('admin') or an additional admin (ADM-x). */
export function isManagerId(id: string) {
  return id === 'admin' || id.startsWith('ADM-');
}
