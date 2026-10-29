'use client';

// One case, top to bottom in the order the work happens: who and what (header),
// where it stands (journey), what to do now (next step), then the material —
// documents, payments, details and history.
import { PHASES } from '@/components/case-trays';
import { ReminderChip, RemindButton, RemindersCard, announceRemindersChanged, useReminders, type OpenReminder, type ReminderTarget } from '@/components/reminders';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import '@/app/styles/case.css';
import { DocumentsPanel, type DocumentItem } from '@/components/documents-panel';
import { useConfig } from '@/components/config-provider';
import { useSession } from '@/components/session-provider';
import { useNewFlow } from '@/components/app-shell';
import { Empty, Field, Segmented, Stamp, StampText, formatDate, shekel, timeAgo } from '@/components/ui/bits';
import { Menu, Modal } from '@/components/ui/overlay';
import { useToast } from '@/components/ui/toast';
import {
  IconArrowLeft,
  IconCheck,
  IconCoins,
  IconDownload,
  IconFile,
  IconFlag,
  IconFolder,
  IconMail,
  IconMore,
  IconPencil,
  IconPhone,
  IconPlus,
  IconTransfer,
  IconTrash,
  IconUpload,
  IconUser,
  IconWhatsapp,
  IconX,
} from '@/components/ui/icons';
import {
  BLANK_CONTRACT_CODE,
  CASE_KIND_LABELS,
  CASE_STAGES,
  CHECKLIST_STATUS_LABELS,
  INVESTIGATION_OUTCOME_LABELS,
  PAYMENT_STATUS_LABELS,
  companyColor,
  isUnderInvestigation,
  optionLabel,
  stageLabelOf,
  type CaseKind,
  type CaseStage,
  type ChecklistStatus,
  type DecisionStatus,
  type InvestigationOutcome,
  type OperatingCompany,
  type PaymentMethod,
} from '@/lib/domain';

type ChecklistEntry = { code: string; label: string; status: ChecklistStatus; note?: string; documentIds: string[] };

type CaseDetail = {
  case: {
    id: string;
    clientId: string;
    title: string;
    office: string;
    officeOther?: string;
    officeName: string;
    stage: CaseStage;
    checklist: ChecklistEntry[];
    fee: number;
    referenceNumber?: string;
    nextAction?: string;
    notes?: string;
    description?: string;
    decision?: string;
    decisionStatus?: DecisionStatus;
    investigationOutcome?: InvestigationOutcome;
    company?: OperatingCompany;
    caseKind?: CaseKind;
    troubleFlag?: boolean;
    troubleNote?: string;
    /** Who handles the case now: a worker id, 'admin' or ADM-x. */
    handlerId: string;
    handlerName?: string;
    paymentStatusOverride?: 'paid' | 'partial' | 'unpaid';
    openedAt: string;
    submittedAt?: string;
    decisionAt?: string;
    closedAt?: string;
    missingItems: number;
    finance: { fee: number; paid: number; balance: number; status: 'paid' | 'partial' | 'unpaid'; overridden?: boolean };
  };
  client: { id: string; fullName: string; phone: string; email?: string } | null;
  documents: DocumentItem[];
  payments: Array<{ id: string; amount: number; method: PaymentMethod; paidAt: string; note?: string }>;
  activity: Array<{ id: string; summary: string; at: string }>;
  workers: Array<{ id: string; name: string }>;
  managers: Array<{ id: string; name: string }>;
  canManagePayments?: boolean;
  canAssign?: boolean;
  canTransferToManager?: boolean;
  hasBlankContract?: boolean;
};

const STATUS_ORDER: ChecklistStatus[] = ['missing', 'received', 'in-review', 'approved', 'resubmit-needed', 'not-applicable'];

type Tab = 'documents' | 'payments' | 'details' | 'history';

type Ask = {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  input?: { label: string; placeholder?: string; initial?: string; multiline?: boolean };
  /** Return false to keep the dialog open. */
  run: (value: string) => Promise<boolean | void>;
};

/** Israeli mobile number → wa.me form (972…). */
function waNumber(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return `972${digits.slice(1)}`;
  return digits;
}

function firstName(fullName?: string) {
  return (fullName || '').trim().split(/\s+/)[0] || '';
}

export default function CaseDetailPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = use(params);
  const router = useRouter();
  const config = useConfig();
  const toast = useToast();
  const { me } = useSession();
  const openNew = useNewFlow();
  const [data, setData] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('documents');
  const [ask, setAsk] = useState<Ask | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const { reminders } = useReminders({ caseId });

  const reload = useCallback(() => {
    return fetch(`/api/cases/${caseId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setData(d.data);
        else setData(null);
        // A change here may have filled a gap a reminder was watching.
        announceRemindersChanged();
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [caseId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const linkedLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const item of data?.case.checklist ?? []) for (const id of item.documentIds) map[id] = item.label;
    return map;
  }, [data]);

  if (loading) {
    return (
      <div className="stack">
        <div className="skeleton" style={{ height: 120, marginTop: 22 }} />
        <div className="skeleton" style={{ height: 150 }} />
        <div className="skeleton" style={{ height: 260 }} />
      </div>
    );
  }

  if (!data) {
    return (
      <Empty
        icon={<IconFolder size={28} />}
        title="התיק לא נמצא"
        action={
          <Link className="button button-secondary" href="/cases">
            לכל התיקים
          </Link>
        }
      >
        ייתכן שהתיק נמחק, או שהועבר לטיפול של מישהו אחר.
      </Empty>
    );
  }

  const c = data.case;
  const client = data.client;
  const isAdmin = Boolean(me?.isAdmin ?? data.canAssign);
  const stageIndex = CASE_STAGES.indexOf(c.stage);
  const underInvestigation = isUnderInvestigation(c);
  const rejected = c.investigationOutcome === 'rejected';
  const stageName = (stage: CaseStage) => stageLabelOf(config, stage);
  const color = companyColor(config, c.company);
  const companyName = c.company && c.company !== 'none' ? optionLabel(config.companies, c.company, '') : '';
  const missing = c.checklist.filter((i) => i.status === 'missing' || i.status === 'resubmit-needed');
  const counted = c.checklist.filter((i) => i.status !== 'not-applicable');
  const arrived = counted.filter((i) => i.status === 'received' || i.status === 'approved' || i.status === 'in-review');
  const toReview = c.checklist.filter((i) => i.status === 'received' || i.status === 'in-review');
  const people = [...data.managers, ...data.workers];

  // ── Server calls ─────────────────────────────────────────────────────────

  async function patchCase(body: Record<string, unknown>, success?: string) {
    const res = await fetch(`/api/cases/${caseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.ok) {
      toast(result.error || 'העדכון לא נשמר', 'error');
      return null;
    }
    if (success) toast(success);
    await reload();
    return result as { ok: true; stillVisible?: boolean };
  }

  async function checklistCall(method: 'POST' | 'PATCH' | 'DELETE', body?: object, query = '') {
    const res = await fetch(`/api/cases/${caseId}/checklist${query}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.ok) {
      toast(result.error || 'העדכון לא נשמר', 'error');
      return false;
    }
    await reload();
    return true;
  }

  async function uploadTo(code: string, files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    const form = new FormData();
    for (const file of list) form.append('file', file);
    form.append('caseId', caseId);
    form.append('checklistCode', code);
    const res = await fetch(`/api/clients/${c.clientId}/documents`, { method: 'POST', body: form });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.ok) {
      toast(result.error || 'ההעלאה נכשלה', 'error');
      return;
    }
    toast(list.length === 1 ? 'הקובץ נשמר ושויך למסמך' : `${list.length} קבצים נשמרו ושויכו למסמך`);
    await reload();
  }

  // ── Stage moves ──────────────────────────────────────────────────────────

  function moveTo(stage: CaseStage, extra: Record<string, unknown> = {}) {
    return patchCase({ stage, ...extra }, `התיק עבר לשלב: ${stageName(stage)}`);
  }

  /** Forward moves apply at once; going back or closing asks first. */
  function requestStage(stage: CaseStage) {
    if (stage === c.stage) return;
    const back = CASE_STAGES.indexOf(stage) < stageIndex;
    if (!back && stage !== 'closed') {
      void moveTo(stage);
      return;
    }
    setAsk({
      title: stage === 'closed' ? 'סגירת התיק' : 'החזרת התיק לשלב קודם',
      body:
        stage === 'closed' ? (
          <p className="ask-text">התיק יסומן כסגור ויירד מהרשימות הפעילות. אפשר לפתוח אותו מחדש בכל עת.</p>
        ) : (
          <p className="ask-text">
            התיק יחזור מ&quot;{stageName(c.stage)}&quot; ל&quot;{stageName(stage)}&quot;.
          </p>
        ),
      confirmLabel: stage === 'closed' ? 'סגירת התיק' : `החזרה ל${stageName(stage)}`,
      run: async () => Boolean(await moveTo(stage)),
    });
  }

  function officeApproved() {
    setAsk({
      title: 'המשרד אישר את הבקשה',
      body: <p className="ask-text">התיק יעבור ל&quot;{stageName('awaiting-payment')}&quot; ויסומן כמאושר.</p>,
      confirmLabel: 'אישור — מעבר לתשלום',
      run: async () => Boolean(await moveTo('awaiting-payment', { decisionStatus: 'approved', investigationOutcome: '' })),
    });
  }

  function officeNeedsMore() {
    setAsk({
      title: 'המשרד ביקש השלמה',
      confirmLabel: 'שמירה',
      input: { label: 'מה המשרד ביקש להשלים?', placeholder: 'לדוגמה: תלושי שכר של 3 החודשים האחרונים', initial: c.stage === 'action-required' ? c.nextAction : '', multiline: true },
      run: async (note) =>
        Boolean(
          await patchCase(
            { stage: 'action-required', nextAction: note.trim() || 'נדרשת השלמה מהמשרד' },
            'נשמר — התיק מסומן "נדרשת השלמה"',
          ),
        ),
    });
  }

  function officeInvestigation() {
    setAsk({
      title: 'התיק הועבר לחקירה',
      body: <p className="ask-text">התיק יסומן באדום עד שתעדכנו את תוצאת החקירה.</p>,
      confirmLabel: 'סימון: בחקירה',
      danger: true,
      run: async () => Boolean(await patchCase({ decisionStatus: 'investigation', investigationOutcome: '' }, 'התיק סומן כבחקירה')),
    });
  }

  function concludeInvestigation(outcome: InvestigationOutcome) {
    setAsk({
      title: outcome === 'approved' ? 'החקירה הסתיימה באישור' : 'הבקשה נדחתה',
      body:
        outcome === 'approved' ? (
          <p className="ask-text">התיק יעבור ל&quot;{stageName('awaiting-payment')}&quot;.</p>
        ) : (
          <p className="ask-text">התיק יעבור ל&quot;{stageName('decision-received')}&quot; עם סטטוס נדחה.</p>
        ),
      confirmLabel: outcome === 'approved' ? 'אישור — מעבר לתשלום' : 'סימון: נדחה',
      danger: outcome === 'rejected',
      run: async () =>
        Boolean(
          await patchCase(
            { investigationOutcome: outcome, stage: outcome === 'approved' ? 'awaiting-payment' : 'decision-received' },
            outcome === 'approved' ? 'החקירה הסתיימה באישור' : 'הבקשה סומנה כנדחתה',
          ),
        ),
    });
  }

  function flagCase() {
    setAsk({
      title: 'סימון התיק כתקוע',
      confirmLabel: 'סימון',
      danger: true,
      input: { label: 'מה עוצר את התיק? (לא חובה)', placeholder: 'לדוגמה: הלקוח לא עונה כבר שבוע', multiline: true },
      run: async (note) => Boolean(await patchCase({ troubleFlag: true, troubleNote: note.trim() }, 'התיק סומן כתקוע')),
    });
  }

  async function transferTo(id: string) {
    const target = people.find((p) => p.id === id);
    const result = await patchCase({ assignedTo: id });
    if (!result) return false;
    // A worker who hands the case on no longer sees it.
    if (result.stillVisible === false) {
      toast(`התיק הועבר ל${target?.name ?? 'מנהל'}`);
      router.push('/cases' as never);
      return true;
    }
    toast(`התיק הועבר ל${target?.name ?? ''}`);
    return true;
  }

  async function deleteThisCase() {
    const res = await fetch(`/api/cases/${caseId}`, { method: 'DELETE' });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast(d.error || 'מחיקת התיק נכשלה', 'error');
      return;
    }
    toast('התיק נמחק');
    router.push(`/clients/${c.clientId}` as never);
  }

  // ── Requests to the client (opens the office's own WhatsApp / mail) ─────

  const requestText = [
    `שלום ${firstName(client?.fullName)},`,
    `להשלמת התיק${c.title ? ` (${c.title})` : ''} חסרים עדיין המסמכים הבאים:`,
    ...missing.map((i) => `• ${i.label}${i.status === 'resubmit-needed' ? ' (נדרש מחדש)' : ''}`),
    '',
    'אפשר לשלוח צילום או קובץ בתשובה להודעה הזו.',
    'תודה,',
    config.businessName,
  ].join('\n');
  const waHref = client?.phone ? `https://wa.me/${waNumber(client.phone)}?text=${encodeURIComponent(requestText)}` : '';
  const mailHref = client?.email
    ? `mailto:${client.email}?subject=${encodeURIComponent(`מסמכים חסרים${c.title ? ` — ${c.title}` : ''}`)}&body=${encodeURIComponent(requestText)}`
    : '';

  function goToTab(next: Tab) {
    setTab(next);
    requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  // ── The "next step" for the current stage ────────────────────────────────

  function nextStep(): { title: string; body?: ReactNode; actions: ReactNode } {
    if (underInvestigation) {
      return {
        title: 'התיק בחקירה — ממתינים למסקנה',
        body: <p className="next-step-text">כשהמשרד מודיע על תוצאת החקירה, עדכנו כאן.</p>,
        actions: (
          <>
            <button type="button" className="button" onClick={() => concludeInvestigation('approved')}>
              <IconCheck size={16} />
              החקירה הסתיימה באישור
            </button>
            <button type="button" className="button button-secondary" onClick={() => concludeInvestigation('rejected')}>
              הבקשה נדחתה
            </button>
          </>
        ),
      };
    }

    switch (c.stage) {
      case 'new-client':
      case 'collecting-documents': {
        if (missing.length > 0) {
          return {
            title: missing.length === 1 ? 'חסר מסמך אחד מהלקוח' : `חסרים ${missing.length} מסמכים מהלקוח`,
            body: (
              <div className="missing-list">
                {missing.slice(0, 8).map((i) => (
                  <span key={i.code} className="file-pill">
                    {i.label}
                  </span>
                ))}
                {missing.length > 8 && <span className="tiny muted">ועוד {missing.length - 8}</span>}
              </div>
            ),
            actions: (
              <>
                {waHref ? (
                  <a className="button" href={waHref} target="_blank" rel="noreferrer">
                    <IconWhatsapp size={16} />
                    בקשת המסמכים בוואטסאפ
                  </a>
                ) : null}
                {mailHref ? (
                  <a className={waHref ? 'button button-secondary' : 'button'} href={mailHref}>
                    <IconMail size={16} />
                    בקשה במייל
                  </a>
                ) : null}
                <button type="button" className="button button-secondary" onClick={() => goToTab('documents')}>
                  <IconUpload size={16} />
                  העלאת מסמכים שהתקבלו
                </button>
                {c.stage === 'new-client' && (
                  <button type="button" className="button button-quiet" onClick={() => void moveTo('collecting-documents')}>
                    סימון: באיסוף מסמכים
                  </button>
                )}
              </>
            ),
          };
        }
        return {
          title: c.checklist.length ? 'כל המסמכים התקבלו' : 'אין רשימת מסמכים לתיק',
          body: (
            <p className="next-step-text">
              {c.checklist.length
                ? 'הגיע הזמן לעבור עליהם ולוודא שהכול תקין.'
                : 'אפשר להוסיף מסמכים נדרשים בלשונית המסמכים, או להמשיך ישר לבדיקה.'}
            </p>
          ),
          actions: (
            <button type="button" className="button" onClick={() => void moveTo('documents-review')}>
              מעבר לבדיקת המסמכים
              <IconArrowLeft size={16} />
            </button>
          ),
        };
      }

      case 'documents-review':
        return {
          title: toReview.length ? `לבדוק ${toReview.length === 1 ? 'מסמך אחד' : `${toReview.length} מסמכים`} ולאשר` : 'המסמכים נבדקו',
          body: (
            <p className="next-step-text">
              סמנו כל מסמך כ&quot;אושר&quot; או &quot;נדרש מחדש&quot;. כשהכול תקין — מכינים את הבקשה לשליחה ללקוח.
            </p>
          ),
          actions: (
            <>
              <button type="button" className="button" onClick={() => void moveTo('ready-for-client')}>
                המסמכים תקינים — מוכן ללקוח
                <IconArrowLeft size={16} />
              </button>
              {toReview.length > 0 && (
                <button type="button" className="button button-secondary" onClick={() => goToTab('documents')}>
                  לרשימת המסמכים
                </button>
              )}
              <button type="button" className="button button-quiet" onClick={() => requestStage('collecting-documents')}>
                חסר משהו — חזרה לאיסוף
              </button>
            </>
          ),
        };

      case 'ready-for-client':
        return {
          title: 'לשלוח ללקוח את הבקשה המוכנה',
          body: <p className="next-step-text">בחרו בלשונית המסמכים את הקבצים לשליחה, ושלחו ללקוח בקישור אחד במייל או בוואטסאפ.</p>,
          actions: (
            <>
              <button type="button" className="button" onClick={() => void moveTo('sent-to-client')}>
                <IconCheck size={16} />
                סימון: נשלח ללקוח
              </button>
              <button type="button" className="button button-secondary" onClick={() => goToTab('documents')}>
                בחירת מסמכים לשליחה
              </button>
            </>
          ),
        };

      case 'sent-to-client':
        return {
          title: 'כשהלקוח מאשר — מגישים למשרד',
          body: <p className="next-step-text">אחרי ההגשה רשמו את מספר התיק שהמשרד נתן, כדי שיהיה בהישג יד בכל שיחה.</p>,
          actions: (
            <button
              type="button"
              className="button"
              onClick={() =>
                setAsk({
                  title: 'הגשה למשרד',
                  confirmLabel: 'סימון: הוגש למשרד',
                  input: { label: 'מספר התיק במשרד (אם כבר ידוע)', initial: c.referenceNumber, placeholder: 'אפשר להשאיר ריק ולהוסיף אחר כך' },
                  run: async (ref) =>
                    Boolean(await moveTo('submitted', ref.trim() ? { referenceNumber: ref.trim() } : {})),
                })
              }
            >
              <IconCheck size={16} />
              סימון: הוגש למשרד
            </button>
          ),
        };

      case 'submitted':
      case 'in-government-review':
        return {
          title: 'ממתינים לתשובת המשרד',
          body: (
            <p className="next-step-text">
              {c.submittedAt ? `הוגש ${timeAgo(c.submittedAt)}. ` : ''}מה המשרד השיב?
            </p>
          ),
          actions: (
            <>
              <button type="button" className="button" onClick={officeApproved}>
                <IconCheck size={16} />
                המשרד אישר
              </button>
              <button type="button" className="button button-secondary" onClick={officeNeedsMore}>
                ביקשו השלמה
              </button>
              <button type="button" className="button button-secondary" onClick={officeInvestigation}>
                הועבר לחקירה
              </button>
              {c.stage === 'submitted' && (
                <button type="button" className="button button-quiet" onClick={() => void moveTo('in-government-review')}>
                  סימון: בטיפול המשרד
                </button>
              )}
            </>
          ),
        };

      case 'action-required':
        return {
          title: 'המשרד ביקש השלמה',
          body: c.nextAction ? <p className="next-step-quote">{c.nextAction}</p> : <p className="next-step-text">שלחו למשרד את מה שביקש, ועדכנו כאן.</p>,
          actions: (
            <>
              <button type="button" className="button" onClick={() => void moveTo('in-government-review', { nextAction: '' })}>
                <IconCheck size={16} />
                ההשלמה נשלחה למשרד
              </button>
              <button type="button" className="button button-secondary" onClick={officeApproved}>
                המשרד אישר
              </button>
              <button type="button" className="button button-secondary" onClick={officeNeedsMore}>
                עדכון הבקשה
              </button>
              <button type="button" className="button button-quiet" onClick={officeInvestigation}>
                הועבר לחקירה
              </button>
            </>
          ),
        };

      case 'decision-received':
        if (rejected) {
          return {
            title: 'הבקשה נדחתה',
            body: <p className="next-step-text">אם אין מה לערער — סגרו את התיק.</p>,
            actions: (
              <button type="button" className="button" onClick={() => requestStage('closed')}>
                סגירת התיק
              </button>
            ),
          };
        }
        if (c.decisionStatus === 'approved' || c.investigationOutcome === 'approved') {
          return {
            title: 'הבקשה אושרה',
            body: <p className="next-step-text">נשאר לגבות את שכר הטרחה.</p>,
            actions: (
              <button type="button" className="button" onClick={() => void moveTo('awaiting-payment')}>
                מעבר לתשלום
                <IconArrowLeft size={16} />
              </button>
            ),
          };
        }
        return {
          title: 'מה החליט המשרד?',
          actions: (
            <>
              <button type="button" className="button" onClick={officeApproved}>
                <IconCheck size={16} />
                אושר
              </button>
              <button type="button" className="button button-secondary" onClick={officeInvestigation}>
                הועבר לחקירה
              </button>
            </>
          ),
        };

      case 'awaiting-payment':
        if (!data!.canManagePayments) {
          return {
            title: 'הבקשה אושרה — ממתין לתשלום',
            body: <p className="next-step-text">הגבייה אצל המנהל. כשהתשלום מתקבל, התיק נסגר.</p>,
            actions: null,
          };
        }
        if (c.finance.balance > 0 && c.finance.status !== 'paid') {
          return {
            title: `נשאר לגבות ${shekel(c.finance.balance)}`,
            body: (
              <p className="next-step-text">
                שכר טרחה {shekel(c.finance.fee)}
                {c.finance.paid > 0 ? `, שולם עד עכשיו ${shekel(c.finance.paid)}` : ''}.
              </p>
            ),
            actions: (
              <>
                <button type="button" className="button" onClick={() => setPayOpen(true)}>
                  <IconCoins size={16} />
                  רישום תשלום
                </button>
                <button type="button" className="button button-quiet" onClick={() => requestStage('closed')}>
                  סגירת התיק
                </button>
              </>
            ),
          };
        }
        return {
          title: 'התשלום התקבל',
          body: <p className="next-step-text">הכול הושלם — אפשר לסגור את התיק.</p>,
          actions: (
            <button type="button" className="button" onClick={() => requestStage('closed')}>
              סגירת התיק
            </button>
          ),
        };

      case 'closed':
      default:
        return {
          title: 'התיק סגור',
          body: <p className="next-step-text">{c.closedAt ? `נסגר ב-${formatDate(c.closedAt)}.` : ''} אם צריך לחזור אליו — בחרו שלב במסלול למעלה.</p>,
          actions: client ? (
            <button type="button" className="button button-secondary" onClick={() => openNew({ mode: 'case', clientId: client.id, clientName: client.fullName })}>
              <IconPlus size={16} />
              תיק חדש ללקוח
            </button>
          ) : null,
        };
    }
  }

  const step = nextStep();

  // The reminder offered next to the next step watches whatever is still open.
  const about = [client?.fullName, c.title].filter(Boolean).join(' · ');
  const reminderBase = { about, caseId: c.id, clientId: c.clientId, handlerId: c.handlerId, handlerName: c.handlerName };
  const awaitingMoney = c.stage === 'awaiting-payment' || (c.stage === 'decision-received' && c.finance.balance > 0);
  const stepReminder: ReminderTarget = missing.length
    ? {
        ...reminderBase,
        title: `לבדוק אם הגיעו ${missing.length === 1 ? `"${missing[0].label}"` : `${missing.length} המסמכים החסרים`} — ${client?.fullName ?? ''}`,
        watch: missing.length === 1 ? { kind: 'checklist-item', code: missing[0].code } : { kind: 'case-documents' },
      }
    : awaitingMoney && c.fee > 0
      ? { ...reminderBase, title: `לבדוק תשלום שכר טרחה — ${client?.fullName ?? ''}`, watch: { kind: 'case-payment' } }
      : { ...reminderBase, title: `${step.title} — ${client?.fullName ?? ''}` };
  const itemReminder = (item: { code: string; label: string }): ReminderTarget => ({
    ...reminderBase,
    title: `לבדוק אם הגיע "${item.label}" — ${client?.fullName ?? ''}`,
    watch: { kind: 'checklist-item', code: item.code },
  });

  // ── Header stamps ────────────────────────────────────────────────────────

  const stamps: ReactNode[] = [];
  if (underInvestigation) stamps.push(<StampText key="inv" tone="missing">בחקירה</StampText>);
  else if (rejected) stamps.push(<StampText key="rej" tone="missing">נדחה</StampText>);
  else if (c.decisionStatus === 'approved' || c.investigationOutcome === 'approved') stamps.push(<StampText key="ok" tone="approved">אושר</StampText>);
  if (c.stage === 'closed') stamps.push(<StampText key="closed" tone="na">סגור</StampText>);
  // Payment only matters once it is due (or money already came in).
  if (data.canManagePayments && (c.finance.paid > 0 || (c.fee > 0 && stageIndex >= CASE_STAGES.indexOf('awaiting-payment')))) {
    const tone = c.finance.status === 'paid' ? 'approved' : c.finance.status === 'partial' ? 'review' : 'na';
    stamps.push(
      <StampText key="pay" tone={tone}>
        {PAYMENT_STATUS_LABELS[c.finance.status]}
      </StampText>,
    );
  }

  return (
    <div className="case-page">
      <div className="page-eyebrow case-crumbs">
        <Link href="/cases">תיקים</Link>
        <span aria-hidden="true">/</span>
        {client ? <Link href={`/clients/${client.id}` as never}>{client.fullName}</Link> : <span>לקוח</span>}
      </div>

      {/* ── Header: a file folder whose tab carries the company colour ── */}
      <section className={`folder case-head ${c.troubleFlag || underInvestigation ? 'flagged' : ''}`} style={{ '--co': color } as CSSProperties}>
        <span className={`folder-tab ${color ? '' : 'none'}`}>{companyName || 'ללא חברה'}</span>
        <div className="case-head-main">
          <div style={{ minWidth: 0 }}>
            <div className="case-head-meta">
              <span className="mono">{c.id}</span>
              {c.caseKind === 'renewal' && <span className="chip">{CASE_KIND_LABELS.renewal}</span>}
              <span className="muted">נפתח {formatDate(c.openedAt)}</span>
            </div>
            <h1 className="page-title case-title">{client?.fullName || c.title}</h1>
            <div className="case-head-sub">
              <span>{c.title}</span>
              <span className="dot-sep" aria-hidden="true" />
              <span>{c.officeName}</span>
              {c.referenceNumber && (
                <>
                  <span className="dot-sep" aria-hidden="true" />
                  <span>
                    מס׳ במשרד <span className="mono">{c.referenceNumber}</span>
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="case-head-side">
            <button
              type="button"
              className="handler-chip"
              onClick={() => setTransferOpen(true)}
              disabled={!data.canAssign && !(data.canTransferToManager && data.managers.length > 0)}
              title="מי מטפל בתיק — לחיצה להעברה"
            >
              <IconUser size={15} />
              <span className="truncate">{c.handlerName || 'מנהל'}</span>
              {(data.canAssign || (data.canTransferToManager && data.managers.length > 0)) && <IconTransfer size={14} />}
            </button>
            <Menu trigger={<IconMore size={18} />} label="פעולות נוספות על התיק">
              {(data.canAssign || (data.canTransferToManager && data.managers.length > 0)) && (
                <button type="button" className="menu-item" onClick={() => setTransferOpen(true)}>
                  <IconTransfer size={16} />
                  {data.canAssign ? 'העברת התיק לאחר' : 'העברה למנהל'}
                </button>
              )}
              {c.troubleFlag ? (
                <button type="button" className="menu-item" onClick={() => void patchCase({ troubleFlag: false, troubleNote: '' }, 'הסימון הוסר')}>
                  <IconFlag size={16} />
                  הסרת סימון &quot;תקוע&quot;
                </button>
              ) : (
                <button type="button" className="menu-item" onClick={flagCase}>
                  <IconFlag size={16} />
                  סימון התיק כתקוע
                </button>
              )}
              {client && (
                <button type="button" className="menu-item" onClick={() => openNew({ mode: 'case', clientId: client.id, clientName: client.fullName })}>
                  <IconPlus size={16} />
                  תיק נוסף ללקוח
                </button>
              )}
              {isAdmin && data.canAssign && (
                <>
                  <div className="menu-sep" />
                  <button type="button" className="menu-item danger" onClick={() => setDeleteOpen(true)}>
                    <IconTrash size={16} />
                    מחיקת התיק
                  </button>
                </>
              )}
            </Menu>
          </div>
        </div>
        {(stamps.length > 0 || c.missingItems > 0) && (
          <div className="case-head-stamps">
            {c.missingItems > 0 && (
              <StampText tone="missing">{c.missingItems === 1 ? 'חסר מסמך' : `חסרים ${c.missingItems} מסמכים`}</StampText>
            )}
            {stamps}
          </div>
        )}
      </section>

      {c.troubleFlag && (
        <div className="notice danger case-flag">
          <IconFlag size={16} />
          <div style={{ flex: 1 }}>
            <strong>התיק מסומן כתקוע</strong>
            {c.troubleNote ? ` — ${c.troubleNote}` : ''}
          </div>
          <button type="button" className="button button-quiet button-compact" onClick={() => void patchCase({ troubleFlag: false, troubleNote: '' }, 'הסימון הוסר')}>
            הסרת הסימון
          </button>
        </div>
      )}

      {/* ── Journey ── */}
      <nav className="journey case-journey" aria-label="שלבי התיק">
        {PHASES.map((phase) => {
          const first = CASE_STAGES.indexOf(phase.stages[0]);
          const last = CASE_STAGES.indexOf(phase.stages[phase.stages.length - 1]);
          const state = stageIndex > last || (c.stage === 'closed' && phase.stages.includes('closed')) ? 'done' : stageIndex >= first ? 'current' : '';
          return (
            <div key={phase.id} className={`phase ${state}`}>
              <div className="phase-name">
                {state === 'done' && <IconCheck size={14} />}
                {phase.label}
              </div>
              <div className="phase-stages">
                {phase.stages.map((stage) => {
                  const i = CASE_STAGES.indexOf(stage);
                  const cls = stage === c.stage ? 'now' : i < stageIndex ? 'done' : '';
                  return (
                    <button
                      key={stage}
                      type="button"
                      className={`stage-step ${cls}`}
                      aria-current={stage === c.stage ? 'step' : undefined}
                      onClick={() => requestStage(stage)}
                      title={stage === c.stage ? 'השלב הנוכחי' : `העברה לשלב: ${stageName(stage)}`}
                    >
                      <span className="pip" />
                      {stageName(stage)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="layout-aside case-body">
        <div className="stack" style={{ minWidth: 0 }}>
          {/* ── Next step ── */}
          <section className={`next-step ${underInvestigation || rejected ? 'alert' : ''}`} key={`${c.stage}-${c.decisionStatus}-${c.investigationOutcome}`}>
            <div className="next-step-head">
              <span className="next-step-label">השלב הבא</span>
              <span className="tiny muted">· {stageName(c.stage)}</span>
            </div>
            <div className="next-step-body">
              <div className="next-step-title">{step.title}</div>
              {step.body}
              <div className="row">
                {step.actions}
                {c.stage !== 'closed' && <RemindButton target={stepReminder} variant="quiet" label="תזכורת לבדוק" />}
              </div>
            </div>
          </section>

          {/* ── Tabs ── */}
          <div ref={tabsRef} className="tabs" role="tablist" style={{ scrollMarginTop: 80 }}>
            <TabButton id="documents" tab={tab} setTab={setTab} label="מסמכים" count={missing.length ? `${missing.length} חסרים` : String(data.documents.length)} />
            {data.canManagePayments && <TabButton id="payments" tab={tab} setTab={setTab} label="תשלומים" count={data.payments.length ? String(data.payments.length) : undefined} />}
            <TabButton id="details" tab={tab} setTab={setTab} label="פרטי התיק" />
            <TabButton id="history" tab={tab} setTab={setTab} label="היסטוריה" count={data.activity.length ? String(data.activity.length) : undefined} />
          </div>

          <div role="tabpanel" className="tab-panel" key={tab}>
            {tab === 'documents' && (
              <>
                <ChecklistCard
                  checklist={c.checklist}
                  documents={data.documents}
                  hasBlankContract={Boolean(data.hasBlankContract)}
                  templates={config.documentTemplates}
                  arrived={arrived.length}
                  total={counted.length}
                  onStatus={(code, status) => checklistCall('PATCH', { code, status })}
                  onAdd={(body) => checklistCall('POST', body)}
                  onRemove={(codes) =>
                    checklistCall('DELETE', undefined, codes.length === 1 ? `?code=${encodeURIComponent(codes[0])}` : `?codes=${codes.map(encodeURIComponent).join(',')}`)
                  }
                  onClear={() =>
                    setAsk({
                      title: 'ריקון רשימת המסמכים',
                      body: <p className="ask-text">כל הפריטים יוסרו מהרשימה. הקבצים עצמם נשארים בתיק.</p>,
                      confirmLabel: 'ריקון הרשימה',
                      danger: true,
                      run: async () => checklistCall('DELETE', undefined, '?clear=1'),
                    })
                  }
                  onUpload={uploadTo}
                  confirm={setAsk}
                  reminders={reminders}
                  remindTarget={itemReminder}
                />
                <section className="card">
                  <div className="card-head" style={{ marginBottom: 10 }}>
                    <div>
                      <div className="card-title">כל הקבצים בתיק</div>
                      <div className="card-sub">כולל קבצים שלא שויכו לרשימה. אפשר לבחור כמה ולשלוח ללקוח בקישור אחד, או להוריד כ-ZIP.</div>
                    </div>
                    <Link className="text-link small" href={`/clients/${c.clientId}` as never}>
                      לתיקיית הלקוח המלאה
                    </Link>
                  </div>
                  <DocumentsPanel
                    clientId={c.clientId}
                    caseId={caseId}
                    documents={data.documents}
                    checklistOptions={c.checklist
                      .filter((i) => i.status === 'missing' || i.status === 'resubmit-needed' || i.status === 'received')
                      .map((i) => ({ code: i.code, label: i.label }))}
                    clientContact={client ? { email: client.email, phone: client.phone } : undefined}
                    onChanged={() => void reload()}
                    linkedLabels={linkedLabels}
                    emptyText="אין עדיין קבצים בתיק. גררו לכאן קבצים, או העלו ישירות ליד כל מסמך ברשימה."
                  />
                </section>
              </>
            )}

            {tab === 'payments' && data.canManagePayments && (
              <PaymentsCard
                finance={c.finance}
                override={c.paymentStatusOverride}
                payments={data.payments}
                methods={config.paymentMethods}
                onAdd={() => setPayOpen(true)}
                onFee={(fee) => patchCase({ fee }, 'שכר הטרחה עודכן')}
                onOverride={(value) => patchCase({ paymentStatusOverride: value }, 'סטטוס התשלום עודכן')}
                onEditPayment={async (id, body) => {
                  const res = await fetch(`/api/payments/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                  });
                  if (!res.ok) {
                    toast('עדכון התשלום נכשל', 'error');
                    return false;
                  }
                  toast('התשלום עודכן');
                  await reload();
                  return true;
                }}
                onDeletePayment={(p) =>
                  setAsk({
                    title: 'מחיקת תשלום',
                    body: (
                      <p className="ask-text">
                        התשלום של {shekel(p.amount)} מ-{formatDate(p.paidAt)} יימחק.
                      </p>
                    ),
                    confirmLabel: 'מחיקת התשלום',
                    danger: true,
                    run: async () => {
                      const res = await fetch(`/api/payments/${p.id}`, { method: 'DELETE' });
                      if (!res.ok) {
                        toast('מחיקת התשלום נכשלה', 'error');
                        return false;
                      }
                      toast('התשלום נמחק');
                      await reload();
                    },
                  })
                }
              />
            )}

            {tab === 'details' && (
              <>
                <DetailsCard detail={data} onSave={(body) => patchCase(body, 'פרטי התיק נשמרו')} />
                {(stageIndex >= CASE_STAGES.indexOf('submitted') || c.decisionStatus) && (
                  <section className="card">
                    <div className="card-head">
                      <div>
                        <div className="card-title">החלטת המשרד</div>
                        <div className="card-sub">תיקון ידני של ההחלטה, אם עודכנה בטעות.</div>
                      </div>
                    </div>
                    <div className="stack" style={{ gap: 12 }}>
                      <div className="row">
                        <span className="small muted decision-label">ההחלטה</span>
                        <Segmented<'' | DecisionStatus>
                          label="החלטת המשרד"
                          value={c.decisionStatus ?? ''}
                          onChange={(v) => v && void patchCase(v === 'approved' ? { decisionStatus: 'approved', investigationOutcome: '' } : { decisionStatus: v }, 'ההחלטה עודכנה')}
                          options={[
                            { value: 'approved', label: 'אושר' },
                            { value: 'investigation', label: 'חקירה' },
                          ]}
                        />
                      </div>
                      {c.decisionStatus === 'investigation' && (
                        <div className="row">
                          <span className="small muted decision-label">תוצאת החקירה</span>
                          <Segmented<'' | InvestigationOutcome>
                            label="תוצאת החקירה"
                            value={c.investigationOutcome ?? ''}
                            onChange={(v) => v && void patchCase({ investigationOutcome: v }, 'תוצאת החקירה עודכנה')}
                            options={[
                              { value: 'approved', label: INVESTIGATION_OUTCOME_LABELS.approved },
                              { value: 'rejected', label: INVESTIGATION_OUTCOME_LABELS.rejected },
                            ]}
                          />
                          {!c.investigationOutcome && <span className="tiny muted">עדיין בחקירה</span>}
                        </div>
                      )}
                    </div>
                  </section>
                )}
              </>
            )}

            {tab === 'history' && (
              <section className="card">
                <div className="card-head">
                  <div className="card-title">מה קרה בתיק</div>
                </div>
                {data.activity.length === 0 ? (
                  <p className="muted small" style={{ margin: 0 }}>עדיין לא נרשמה פעילות.</p>
                ) : (
                  <ol className="timeline">
                    {data.activity.map((entry) => (
                      <li key={entry.id}>
                        <span className="timeline-dot" aria-hidden="true" />
                        <div className="small">{entry.summary}</div>
                        <div className="tiny muted" title={formatDate(entry.at, true)}>
                          {timeAgo(entry.at)}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}
          </div>
        </div>

        {/* ── Aside: who to call, who handles it, the money ── */}
        <aside className="stack case-aside">
          <RemindersCard reminders={reminders} />
          {client && (
            <section className="card">
              <div className="card-head" style={{ marginBottom: 10 }}>
                <Link className="card-title text-link" href={`/clients/${client.id}` as never}>
                  {client.fullName}
                </Link>
              </div>
              <div className="contact-list">
                {client.phone && (
                  <a className="contact-row" href={`tel:${client.phone}`}>
                    <IconPhone size={16} />
                    <span className="ltr">{client.phone}</span>
                  </a>
                )}
                {client.phone && (
                  <a className="contact-row" href={`https://wa.me/${waNumber(client.phone)}`} target="_blank" rel="noreferrer">
                    <IconWhatsapp size={16} />
                    וואטסאפ
                  </a>
                )}
                {client.email && (
                  <a className="contact-row" href={`mailto:${client.email}`}>
                    <IconMail size={16} />
                    <span className="ltr truncate">{client.email}</span>
                  </a>
                )}
              </div>
            </section>
          )}

          <section className="card">
            <dl className="kv">
              <dt>מטפל/ת</dt>
              <dd>{c.handlerName || 'מנהל'}</dd>
              <dt>משרד</dt>
              <dd>{c.officeName}</dd>
              <dt>סוג</dt>
              <dd>{CASE_KIND_LABELS[c.caseKind || 'new']}</dd>
              <dt>נפתח</dt>
              <dd>{formatDate(c.openedAt)}</dd>
              {c.submittedAt && (
                <>
                  <dt>הוגש</dt>
                  <dd>{formatDate(c.submittedAt)}</dd>
                </>
              )}
              {c.closedAt && (
                <>
                  <dt>נסגר</dt>
                  <dd>{formatDate(c.closedAt)}</dd>
                </>
              )}
            </dl>
          </section>

          {data.canManagePayments && (
            <section className="card">
              <div className="card-head" style={{ marginBottom: 10 }}>
                <div className="card-title">כסף</div>
                <StampText tone={c.finance.status === 'paid' ? 'approved' : c.finance.status === 'partial' ? 'review' : 'na'}>
                  {PAYMENT_STATUS_LABELS[c.finance.status]}
                </StampText>
              </div>
              <dl className="kv">
                <dt>שכר טרחה</dt>
                <dd className="num">{shekel(c.finance.fee)}</dd>
                <dt>שולם</dt>
                <dd className="num">{shekel(c.finance.paid)}</dd>
                <dt>יתרה</dt>
                <dd className="num strong">{shekel(c.finance.balance)}</dd>
              </dl>
              <button type="button" className="button button-secondary button-compact" style={{ marginTop: 14, width: '100%' }} onClick={() => setPayOpen(true)}>
                <IconCoins size={15} />
                רישום תשלום
              </button>
            </section>
          )}
        </aside>
      </div>

      {/* ── Dialogs ── */}
      {ask && <AskModal ask={ask} onClose={() => setAsk(null)} />}

      {transferOpen && (
        <TransferModal
          current={c.handlerId}
          currentName={c.handlerName}
          managers={data.managers}
          workers={data.workers}
          workerView={!data.canAssign}
          onClose={() => setTransferOpen(false)}
          onTransfer={transferTo}
        />
      )}

      {payOpen && data.canManagePayments && (
        <PaymentModal
          balance={c.finance.balance}
          methods={config.paymentMethods}
          onClose={() => setPayOpen(false)}
          onSave={async (body) => {
            const res = await fetch('/api/payments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ clientId: c.clientId, caseId, ...body }),
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || !result.ok) return result.error || 'רישום התשלום נכשל';
            toast(`נרשם תשלום של ${shekel(body.amount)}`);
            await reload();
            return '';
          }}
        />
      )}

      {deleteOpen && (
        <DeleteModal title={c.title} clientName={client?.fullName} docs={data.documents.length} payments={data.payments.length} onClose={() => setDeleteOpen(false)} onDelete={deleteThisCase} />
      )}
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function TabButton({ id, tab, setTab, label, count }: { id: Tab; tab: Tab; setTab: (t: Tab) => void; label: string; count?: string }) {
  return (
    <button type="button" role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
      {label}
      {count && <span className="count">{count}</span>}
    </button>
  );
}

function AskModal({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  const [value, setValue] = useState(ask.input?.initial ?? '');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const keep = (await ask.run(value)) === false;
      if (!keep) onClose();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={ask.title}
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-secondary" onClick={onClose}>
            ביטול
          </button>
          <button type="button" className={`button ${ask.danger ? 'button-danger' : ''}`} disabled={busy} onClick={() => void go()}>
            {busy ? 'שומר…' : ask.confirmLabel}
          </button>
        </>
      }
    >
      <form
        className="stack"
        style={{ gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        {ask.body}
        {ask.input && (
          <Field label={ask.input.label}>
            {ask.input.multiline ? (
              <textarea rows={3} value={value} placeholder={ask.input.placeholder} onChange={(e) => setValue(e.target.value)} />
            ) : (
              <input value={value} placeholder={ask.input.placeholder} onChange={(e) => setValue(e.target.value)} />
            )}
          </Field>
        )}
      </form>
    </Modal>
  );
}

function ChecklistCard({
  checklist,
  documents,
  hasBlankContract,
  templates,
  arrived,
  total,
  onStatus,
  onAdd,
  onRemove,
  onClear,
  onUpload,
  confirm,
  reminders,
  remindTarget,
}: {
  checklist: ChecklistEntry[];
  documents: DocumentItem[];
  hasBlankContract: boolean;
  templates: { code: string; label: string }[];
  arrived: number;
  total: number;
  onStatus: (code: string, status: ChecklistStatus) => Promise<boolean>;
  onAdd: (body: { code: string } | { label: string }) => Promise<boolean>;
  onRemove: (codes: string[]) => Promise<boolean>;
  onClear: () => void;
  onUpload: (code: string, files: FileList | File[]) => Promise<void>;
  confirm: (ask: Ask) => void;
  reminders: OpenReminder[];
  remindTarget: (item: { code: string; label: string }) => ReminderTarget;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const [overCode, setOverCode] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const targetCode = useRef<string | null>(null);
  const available = templates.filter((t) => !checklist.some((i) => i.code === t.code));
  const pct = total ? Math.round((arrived / total) * 100) : 0;

  async function upload(code: string, files: FileList | File[]) {
    setUploading(code);
    try {
      await onUpload(code, files);
    } finally {
      setUploading(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!newCode && !newLabel.trim()) return;
    const ok = await onAdd(newCode ? { code: newCode } : { label: newLabel.trim() });
    if (ok) {
      setNewCode('');
      setNewLabel('');
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="card-title">מסמכים נדרשים</div>
          {total > 0 ? (
            <div className="checklist-progress">
              <div className="bar" aria-hidden="true">
                <span style={{ width: `${pct}%` }} />
              </div>
              <span className="tiny muted num">
                {arrived} מתוך {total} התקבלו
              </span>
            </div>
          ) : (
            <div className="card-sub">אין רשימה — אפשר להוסיף מסמכים נדרשים למטה, או להעלות קבצים בחופשיות.</div>
          )}
        </div>
        {checklist.length > 0 && (
          <Menu trigger={<IconMore size={18} />} label="פעולות על הרשימה">
            <button type="button" className="menu-item" onClick={() => setSelected(checklist.map((i) => i.code))}>
              <IconCheck size={16} />
              בחירת כל הפריטים
            </button>
            <button type="button" className="menu-item danger" onClick={onClear}>
              <IconTrash size={16} />
              ריקון הרשימה
            </button>
          </Menu>
        )}
      </div>

      {selected.length > 0 && (
        <div className="selection-bar">
          <span className="strong small">{selected.length === 1 ? 'פריט אחד נבחר' : `${selected.length} פריטים נבחרו`}</span>
          <span className="spacer" />
          <button
            type="button"
            className="button button-danger button-compact"
            onClick={() =>
              confirm({
                title: 'הסרה מהרשימה',
                body: <p className="ask-text">{selected.length === 1 ? 'הפריט יוסר' : `${selected.length} פריטים יוסרו`} מרשימת המסמכים הנדרשים. קבצים שכבר הועלו נשארים בתיק.</p>,
                confirmLabel: 'הסרה',
                danger: true,
                run: async () => {
                  const ok = await onRemove(selected);
                  if (ok) setSelected([]);
                  return ok;
                },
              })
            }
          >
            <IconTrash size={15} />
            הסרה מהרשימה
          </button>
          <button type="button" className="button button-quiet button-compact" onClick={() => setSelected([])}>
            ביטול הבחירה
          </button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const code = targetCode.current;
          if (code && e.target.files?.length) void upload(code, e.target.files);
          e.target.value = '';
          targetCode.current = null;
        }}
      />

      <div className="checklist">
        {checklist.map((item) => {
          const files = item.documentIds.map((id) => documents.find((d) => d.id === id)).filter(Boolean) as DocumentItem[];
          return (
            <div
              key={item.code}
              className={`checklist-row ${overCode === item.code ? 'over' : ''} ${selected.includes(item.code) ? 'picked' : ''}`}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('Files')) return;
                e.preventDefault();
                setOverCode(item.code);
              }}
              onDragLeave={() => setOverCode((v) => (v === item.code ? null : v))}
              onDrop={(e) => {
                e.preventDefault();
                setOverCode(null);
                if (e.dataTransfer.files.length) void upload(item.code, e.dataTransfer.files);
              }}
            >
              <input
                type="checkbox"
                className="doc-check"
                checked={selected.includes(item.code)}
                onChange={() => setSelected((prev) => (prev.includes(item.code) ? prev.filter((c) => c !== item.code) : [...prev, item.code]))}
                aria-label={`בחירת ${item.label}`}
              />
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="strong">{item.label}</span>
                  {reminders
                    .filter((r) => r.watchKind === 'checklist-item' && r.watchRef === item.code)
                    .map((r) => (
                      <ReminderChip key={r.id} reminder={r} />
                    ))}
                </div>
                {item.note && <div className="tiny muted">{item.note}</div>}
                {(files.length > 0 || (item.code === BLANK_CONTRACT_CODE && hasBlankContract)) && (
                  <div className="checklist-files">
                    {item.code === BLANK_CONTRACT_CODE && hasBlankContract && (
                      <a className="file-pill blank" href="/api/templates/blank-contract">
                        <IconDownload size={13} />
                        טופס ריק למילוי
                      </a>
                    )}
                    {files.map((doc) => (
                      <a key={doc.id} className="file-pill" href={`/api/documents/${doc.id}`} target="_blank" rel="noreferrer" title={doc.label || doc.originalName}>
                        <IconFile size={13} />
                        <span className="truncate">{doc.label || doc.originalName}</span>
                      </a>
                    ))}
                  </div>
                )}
                {overCode === item.code && <div className="tiny drop-hint">שחררו כדי לשייך ל&quot;{item.label}&quot;</div>}
              </div>
              <StatusMenu status={item.status} label={item.label} onPick={(s) => void onStatus(item.code, s)} />
              <div className="doc-actions">
                {(item.status === 'missing' || item.status === 'resubmit-needed') &&
                  !reminders.some((r) => r.watchKind === 'checklist-item' && r.watchRef === item.code) && (
                    <RemindButton target={remindTarget(item)} variant="icon" label="תזכורת לבדוק אם הגיע" />
                  )}
                <button
                  type="button"
                  className="icon-button small"
                  disabled={uploading === item.code}
                  onClick={() => {
                    targetCode.current = item.code;
                    fileRef.current?.click();
                  }}
                  title="העלאת קבצים למסמך הזה (אפשר גם לגרור לכאן)"
                  aria-label={`העלאה ל${item.label}`}
                >
                  {uploading === item.code ? <span className="spinner" /> : <IconUpload size={15} />}
                </button>
                <button
                  type="button"
                  className="icon-button small"
                  onClick={() =>
                    confirm({
                      title: 'הסרה מהרשימה',
                      body: <p className="ask-text">&quot;{item.label}&quot; יוסר מרשימת המסמכים הנדרשים.{files.length ? ' הקבצים שהועלו נשארים בתיק.' : ''}</p>,
                      confirmLabel: 'הסרה',
                      danger: true,
                      run: async () => {
                        const ok = await onRemove([item.code]);
                        if (ok) setSelected((prev) => prev.filter((c) => c !== item.code));
                        return ok;
                      },
                    })
                  }
                  aria-label={`הסרת ${item.label} מהרשימה`}
                  title="הסרה מהרשימה"
                >
                  <IconX size={15} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <form className="checklist-add" onSubmit={add}>
        <select className="select" value={newCode} onChange={(e) => setNewCode(e.target.value)} aria-label="מסמך מהרשימה הקבועה">
          <option value="">הוספת מסמך מהרשימה…</option>
          {available.map((t) => (
            <option key={t.code} value={t.code}>
              {t.label}
            </option>
          ))}
        </select>
        <input className="input" placeholder="או מסמך אחר — כתבו את שמו" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} disabled={Boolean(newCode)} />
        <button type="submit" className="button button-secondary" disabled={!newCode && !newLabel.trim()}>
          <IconPlus size={16} />
          הוספה
        </button>
      </form>
    </section>
  );
}

/** The stamp itself is the control: click it to re-stamp the document. */
function StatusMenu({ status, label, onPick }: { status: ChecklistStatus; label: string; onPick: (s: ChecklistStatus) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="menu-wrap stamp-menu" ref={wrap}>
      <button
        type="button"
        className="stamp-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`סטטוס ${label}: ${CHECKLIST_STATUS_LABELS[status]}. לחיצה לשינוי`}
        onClick={() => setOpen((v) => !v)}
      >
        <Stamp status={status} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {STATUS_ORDER.filter((s) => s !== status).map((s) => (
            <button
              key={s}
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onPick(s);
              }}
            >
              <Stamp status={s} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PaymentsCard({
  finance,
  override,
  payments,
  methods,
  onAdd,
  onFee,
  onOverride,
  onEditPayment,
  onDeletePayment,
}: {
  finance: CaseDetail['case']['finance'];
  override?: 'paid' | 'partial' | 'unpaid';
  payments: CaseDetail['payments'];
  methods: { value: string; label: string }[];
  onAdd: () => void;
  onFee: (fee: number) => Promise<unknown>;
  onOverride: (value: 'paid' | 'unpaid' | 'auto') => Promise<unknown>;
  onEditPayment: (id: string, body: { amount: number; method: string }) => Promise<boolean>;
  onDeletePayment: (p: CaseDetail['payments'][number]) => void;
}) {
  const [feeEdit, setFeeEdit] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; amount: string; method: string } | null>(null);
  return (
    <>
      <section className="card">
        <div className="money-strip">
          <div>
            <div className="tiny muted">שכר טרחה</div>
            {feeEdit === null ? (
              <button type="button" className="money-value editable" onClick={() => setFeeEdit(String(finance.fee))} title="עריכת שכר הטרחה">
                {shekel(finance.fee)}
                <IconPencil size={14} />
              </button>
            ) : (
              <form
                className="row"
                style={{ gap: 6, flexWrap: 'nowrap' }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const fee = Number(feeEdit);
                  if (!Number.isFinite(fee) || fee < 0) return;
                  if (await onFee(fee)) setFeeEdit(null);
                }}
              >
                <input className="input num" type="number" min="0" value={feeEdit} onChange={(e) => setFeeEdit(e.target.value)} style={{ width: 110, height: 34 }} autoFocus aria-label="שכר טרחה" />
                <button type="submit" className="icon-button small" aria-label="שמירה">
                  <IconCheck size={15} />
                </button>
                <button type="button" className="icon-button small" aria-label="ביטול" onClick={() => setFeeEdit(null)}>
                  <IconX size={15} />
                </button>
              </form>
            )}
          </div>
          <div>
            <div className="tiny muted">שולם</div>
            <div className="money-value">{shekel(finance.paid)}</div>
          </div>
          <div>
            <div className="tiny muted">יתרה</div>
            <div className={`money-value ${finance.balance > 0 ? 'owed' : ''}`}>{shekel(finance.balance)}</div>
          </div>
          <button type="button" className="button" onClick={onAdd}>
            <IconCoins size={16} />
            רישום תשלום
          </button>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <span className="small muted">סטטוס התשלום</span>
          <Segmented<'paid' | 'unpaid' | 'auto'>
            label="סטטוס התשלום"
            value={override === 'paid' ? 'paid' : override === 'unpaid' ? 'unpaid' : 'auto'}
            onChange={(v) => void onOverride(v)}
            options={[
              { value: 'auto', label: 'לפי התשלומים' },
              { value: 'paid', label: 'שולם' },
              { value: 'unpaid', label: 'לא שולם' },
            ]}
          />
          {finance.overridden && <span className="tiny muted">נקבע ידנית</span>}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">תשלומים שהתקבלו</div>
        </div>
        {payments.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>עדיין לא נרשמו תשלומים לתיק.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>תאריך</th>
                  <th>אמצעי</th>
                  <th>הערה</th>
                  <th style={{ textAlign: 'end' }}>סכום</th>
                  <th aria-label="פעולות" />
                </tr>
              </thead>
              <tbody>
                {payments.map((p) =>
                  editing?.id === p.id ? (
                    <tr key={p.id}>
                      <td>{formatDate(p.paidAt)}</td>
                      <td>
                        <select className="select" style={{ height: 34 }} value={editing.method} onChange={(e) => setEditing({ ...editing, method: e.target.value })} aria-label="אמצעי תשלום">
                          {methods.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="muted">{p.note}</td>
                      <td>
                        <input className="input num" type="number" min="0" step="0.01" style={{ height: 34, width: 110 }} value={editing.amount} onChange={(e) => setEditing({ ...editing, amount: e.target.value })} aria-label="סכום" />
                      </td>
                      <td>
                        <div className="doc-actions">
                          <button
                            type="button"
                            className="icon-button small"
                            aria-label="שמירה"
                            onClick={async () => {
                              const amount = Number(editing.amount);
                              if (!Number.isFinite(amount) || amount <= 0) return;
                              if (await onEditPayment(p.id, { amount, method: editing.method })) setEditing(null);
                            }}
                          >
                            <IconCheck size={15} />
                          </button>
                          <button type="button" className="icon-button small" aria-label="ביטול" onClick={() => setEditing(null)}>
                            <IconX size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={p.id}>
                      <td className="nowrap">{formatDate(p.paidAt)}</td>
                      <td>{optionLabel(methods, p.method, p.method)}</td>
                      <td className="muted">{p.note}</td>
                      <td className="num strong" style={{ textAlign: 'end' }}>
                        {shekel(p.amount)}
                      </td>
                      <td>
                        <div className="doc-actions">
                          <button type="button" className="icon-button small" aria-label="עריכת התשלום" onClick={() => setEditing({ id: p.id, amount: String(p.amount), method: p.method })}>
                            <IconPencil size={15} />
                          </button>
                          <button type="button" className="icon-button small" aria-label="מחיקת התשלום" onClick={() => onDeletePayment(p)}>
                            <IconTrash size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function DetailsCard({ detail, onSave }: { detail: CaseDetail; onSave: (body: Record<string, unknown>) => Promise<unknown> }) {
  const config = useConfig();
  const c = detail.case;
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const companies = config.companies.filter((o) => o.value !== 'none' || c.company === 'none' || !c.company);

  function start() {
    setForm({
      title: c.title,
      company: c.company || '',
      caseKind: c.caseKind || 'new',
      office: c.office || '',
      officeOther: c.officeOther || '',
      fee: String(c.fee ?? 0),
      referenceNumber: c.referenceNumber || '',
      nextAction: c.nextAction || '',
      description: c.description || '',
      decision: c.decision || '',
      notes: c.notes || '',
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { ...form, fee: Number(form.fee) || 0 };
      if (!form.company) delete body.company;
      if (await onSave(body)) setForm(null);
    } finally {
      setSaving(false);
    }
  }

  if (!form) {
    return (
      <section className="card">
        <div className="card-head">
          <div className="card-title">פרטי התיק</div>
          <button type="button" className="button button-secondary button-compact" onClick={start}>
            <IconPencil size={15} />
            עריכה
          </button>
        </div>
        <dl className="kv">
          <dt>נושא</dt>
          <dd>{c.title}</dd>
          <dt>חברה מטפלת</dt>
          <dd>{optionLabel(config.companies, c.company || 'none', '—')}</dd>
          <dt>סוג התיק</dt>
          <dd>{CASE_KIND_LABELS[c.caseKind || 'new']}</dd>
          <dt>משרד</dt>
          <dd>{c.officeName}</dd>
          <dt>מס׳ תיק במשרד</dt>
          <dd>{c.referenceNumber ? <span className="mono">{c.referenceNumber}</span> : '—'}</dd>
          {detail.canManagePayments && (
            <>
              <dt>שכר טרחה</dt>
              <dd className="num">{shekel(c.fee)}</dd>
            </>
          )}
          <dt>פעולה הבאה</dt>
          <dd>{c.nextAction || '—'}</dd>
          {c.description && (
            <>
              <dt>תיאור</dt>
              <dd>{c.description}</dd>
            </>
          )}
          {c.decision && (
            <>
              <dt>החלטת המשרד</dt>
              <dd style={{ whiteSpace: 'pre-wrap' }}>{c.decision}</dd>
            </>
          )}
          {c.notes && (
            <>
              <dt>הערות</dt>
              <dd style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</dd>
            </>
          )}
        </dl>
      </section>
    );
  }

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: e.target.value });

  return (
    <form className="card" onSubmit={save}>
      <div className="card-head">
        <div className="card-title">עריכת פרטי התיק</div>
      </div>
      <div className="form-grid">
        <Field label="נושא התיק" full>
          <input value={form.title} onChange={set('title')} required />
        </Field>
        <Field label="חברה מטפלת" required>
          <select value={form.company} onChange={set('company')} required>
            <option value="" disabled>
              בחרו חברה…
            </option>
            {companies.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="סוג התיק">
          <select value={form.caseKind} onChange={set('caseKind')}>
            {Object.entries(CASE_KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="משרד">
          <select value={form.office} onChange={set('office')}>
            {config.offices.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        {form.office === 'other' ? (
          <Field label="שם המשרד">
            <input value={form.officeOther} onChange={set('officeOther')} />
          </Field>
        ) : (
          <Field label="מס׳ תיק במשרד">
            <input value={form.referenceNumber} onChange={set('referenceNumber')} dir="ltr" style={{ textAlign: 'right' }} />
          </Field>
        )}
        {form.office === 'other' && (
          <Field label="מס׳ תיק במשרד">
            <input value={form.referenceNumber} onChange={set('referenceNumber')} dir="ltr" style={{ textAlign: 'right' }} />
          </Field>
        )}
        <Field label="שכר טרחה (₪)">
          <input type="number" min="0" value={form.fee} onChange={set('fee')} />
        </Field>
        <Field label="פעולה הבאה" full>
          <input value={form.nextAction} onChange={set('nextAction')} placeholder="מה צריך לקרות עכשיו בתיק" />
        </Field>
        <Field label="תיאור" full>
          <textarea rows={2} value={form.description} onChange={set('description')} />
        </Field>
        <Field label="החלטת המשרד (טקסט חופשי)" full>
          <textarea rows={2} value={form.decision} onChange={set('decision')} />
        </Field>
        <Field label="הערות" full>
          <textarea rows={3} value={form.notes} onChange={set('notes')} />
        </Field>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button type="submit" className="button" disabled={saving}>
          {saving ? 'שומר…' : 'שמירת הפרטים'}
        </button>
        <button type="button" className="button button-secondary" onClick={() => setForm(null)}>
          ביטול
        </button>
      </div>
    </form>
  );
}

function TransferModal({
  current,
  currentName,
  managers,
  workers,
  workerView,
  onClose,
  onTransfer,
}: {
  current: string;
  currentName?: string;
  managers: { id: string; name: string }[];
  workers: { id: string; name: string }[];
  workerView: boolean;
  onClose: () => void;
  onTransfer: (id: string) => Promise<boolean>;
}) {
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const groups = [
    { label: 'מנהלים', people: managers },
    ...(workerView ? [] : [{ label: 'עובדים', people: workers }]),
  ].filter((g) => g.people.length);
  const target = [...managers, ...workers].find((p) => p.id === pick);

  return (
    <Modal
      title={workerView ? 'העברת התיק למנהל' : 'העברת התיק'}
      subtitle={
        workerView ? 'אחרי ההעברה התיק יעבור לטיפול המנהל וייצא מהרשימה שלך.' : `מטפל/ת כרגע: ${currentName || 'מנהל'}`
      }
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-secondary" onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="button"
            disabled={!pick || busy}
            onClick={async () => {
              setBusy(true);
              const ok = await onTransfer(pick);
              setBusy(false);
              if (ok) onClose();
            }}
          >
            <IconTransfer size={16} />
            {target ? `העברה ל${target.name}` : 'העברה'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        {groups.map((g) => (
          <div key={g.label} className="person-group">
            <div className="tiny muted strong">{g.label}</div>
            {g.people.map((p) => (
              <label key={p.id} className={`person-option ${pick === p.id ? 'on' : ''} ${p.id === current ? 'is-current' : ''}`}>
                <input type="radio" name="transfer-target" value={p.id} checked={pick === p.id} disabled={p.id === current} onChange={() => setPick(p.id)} />
                <span className="avatar-sm">{p.name.trim()[0] || '·'}</span>
                <span className="strong">{p.name}</span>
                {p.id === current && <span className="tiny muted">מטפל/ת כרגע</span>}
              </label>
            ))}
          </div>
        ))}
        {groups.length === 0 && <p className="muted small">אין למי להעביר כרגע.</p>}
      </div>
    </Modal>
  );
}

function PaymentModal({
  balance,
  methods,
  onClose,
  onSave,
}: {
  balance: number;
  methods: { value: string; label: string }[];
  onClose: () => void;
  onSave: (body: { amount: number; method: string; note?: string; paidAt?: string }) => Promise<string>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ amount: balance > 0 ? String(balance) : '', method: methods.find((m) => m.value === 'bank-transfer')?.value ?? methods[0]?.value ?? 'other', note: '', paidAt: today });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('הזינו סכום גדול מאפס');
      return;
    }
    setBusy(true);
    setError('');
    const problem = await onSave({
      amount,
      method: form.method,
      note: form.note.trim() || undefined,
      paidAt: form.paidAt && form.paidAt !== today ? new Date(`${form.paidAt}T12:00:00`).toISOString() : undefined,
    });
    setBusy(false);
    if (problem) setError(problem);
    else onClose();
  }

  return (
    <Modal
      title="רישום תשלום"
      subtitle={balance > 0 ? `יתרה לתשלום: ${shekel(balance)}` : undefined}
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-secondary" onClick={onClose}>
            ביטול
          </button>
          <button type="button" className="button" disabled={busy} onClick={() => void save()}>
            {busy ? 'שומר…' : 'רישום התשלום'}
          </button>
        </>
      }
    >
      <form className="form-grid" onSubmit={save}>
        <Field label="סכום (₪)" required>
          <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required className="num" />
        </Field>
        <Field label="תאריך">
          <input type="date" value={form.paidAt} max={today} onChange={(e) => setForm({ ...form, paidAt: e.target.value })} />
        </Field>
        <Field label="אמצעי תשלום" full>
          <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
            {methods.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="הערה" full>
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="לא חובה — למשל מספר אסמכתא" />
        </Field>
        {error && <p className="form-error full">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function DeleteModal({
  title,
  clientName,
  docs,
  payments,
  onClose,
  onDelete,
}: {
  title: string;
  clientName?: string;
  docs: number;
  payments: number;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="מחיקת התיק"
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-secondary" onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="button button-danger"
            disabled={!sure || busy}
            onClick={async () => {
              setBusy(true);
              await onDelete();
              setBusy(false);
            }}
          >
            <IconTrash size={16} />
            מחיקה לצמיתות
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <p className="ask-text">
          התיק <strong>{title}</strong>
          {clientName ? ` של ${clientName}` : ''} יימחק לצמיתות
          {docs || payments ? `, יחד עם ${[docs ? `${docs} קבצים` : '', payments ? `${payments} תשלומים` : ''].filter(Boolean).join(' ו-')}` : ''}. אי אפשר לשחזר.
        </p>
        <label className="checkbox">
          <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
          כן, למחוק את התיק ואת כל מה שבו
        </label>
      </div>
    </Modal>
  );
}
