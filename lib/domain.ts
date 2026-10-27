/**
 * CRM_YE domain model.
 *
 * CRM_YE manages the full journey of a client whose advisor prepares and
 * submits applications to Israeli government offices: collecting documents,
 * reviewing them, submitting the case, tracking the office's handling,
 * receiving the decision, closing the case, and collecting payment.
 */

export type CaseStage =
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

export const CASE_STAGES: CaseStage[] = [
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

export const STAGE_LABELS: Record<CaseStage, string> = {
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
export const LEGACY_STAGE_MAP: Record<string, CaseStage> = {
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
  /** Editable Hebrew wording for each pipeline stage (keys are fixed). */
  stageLabels: Record<string, string>;
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
  stageLabels: { ...STAGE_LABELS },
};

/** Look up a label in a config option list, falling back to the raw value. */
export function optionLabel(options: ConfigOption[] | undefined, value?: string, fallback = '—') {
  if (!value) return fallback;
  return options?.find((o) => o.value === value)?.label ?? value;
}

/** Stage label from config, falling back to the built-in Hebrew label. */
export function stageLabelOf(config: Pick<AppConfig, 'stageLabels'> | undefined, stage: string) {
  return config?.stageLabels?.[stage] ?? STAGE_LABELS[stage as CaseStage] ?? stage;
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
