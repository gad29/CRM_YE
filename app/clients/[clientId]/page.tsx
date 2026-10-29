'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useState, type CSSProperties } from 'react';
import { DocumentsPanel, type DocumentItem } from '@/components/documents-panel';
import { useConfig } from '@/components/config-provider';
import { useNewFlow } from '@/components/app-shell';
import { useToast } from '@/components/ui/toast';
import { Menu, Modal } from '@/components/ui/overlay';
import { Empty, Field, formatDate, shekel, timeAgo } from '@/components/ui/bits';
import { letters } from '../letters';
import {
  IconArrowRight,
  IconCoins,
  IconFile,
  IconFlag,
  IconFolder,
  IconHistory,
  IconMail,
  IconMore,
  IconPencil,
  IconPhone,
  IconPlus,
  IconTrash,
  IconUser,
  IconWhatsapp,
} from '@/components/ui/icons';
import {
  CLIENT_DETAIL_LABELS,
  PAYMENT_STATUS_LABELS,
  companyColor,
  isUnderInvestigation,
  missingClientDetails,
  optionLabel,
  stageLabelOf,
  type CaseStage,
  type DecisionStatus,
  type InvestigationOutcome,
  type PaymentMethod,
} from '@/lib/domain';
import { PHASES, phaseOf } from '@/components/case-trays';
import { ReminderChip, RemindButton, RemindersCard, announceRemindersChanged, useReminders } from '@/components/reminders';
import '../../styles/lists.css';

type CaseItem = {
  id: string;
  title: string;
  stage: CaseStage;
  officeName?: string;
  missingItems: number;
  troubleFlag?: boolean;
  troubleNote?: string;
  decisionStatus?: DecisionStatus;
  investigationOutcome?: InvestigationOutcome;
  company?: string;
  caseKind?: string;
  nextAction?: string;
  assignedToName?: string;
  openedByName?: string;
  openedAt: string;
  updatedAt: string;
  finance: { fee: number; paid: number; balance: number; status: 'paid' | 'partial' | 'unpaid' };
};

type ClientDetail = {
  client: {
    id: string;
    fullName: string;
    idNumber?: string;
    phone: string;
    email?: string;
    address?: string;
    city?: string;
    notes?: string;
    createdAt: string;
  };
  cases: CaseItem[];
  documents: DocumentItem[];
  payments: Array<{ id: string; amount: number; method: PaymentMethod; paidAt: string; caseId?: string; note?: string }>;
  activity: Array<{ id: string; summary: string; at: string; caseId?: string }>;
  canManagePayments?: boolean;
};

type Tab = 'documents' | 'payments' | 'details' | 'history';

/** wa.me wants the international form: 050-1234567 → 972501234567. */
function whatsappNumber(phone: string) {
  const d = phone.replace(/\D/g, '');
  if (d.startsWith('972')) return d;
  if (d.startsWith('0')) return `972${d.slice(1)}`;
  return d;
}

const EDIT_FIELDS = [
  ['fullName', 'שם מלא', true],
  ['phone', 'טלפון', true],
  ['idNumber', 'תעודת זהות', false],
  ['email', 'אימייל', false],
  ['city', 'עיר', false],
  ['address', 'כתובת', false],
] as const;

const LTR_FIELDS = new Set(['phone', 'idNumber', 'email']);

export default function ClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params);
  const router = useRouter();
  const toast = useToast();
  const openWizard = useNewFlow();
  const [data, setData] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('documents');
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { reminders } = useReminders({ clientId });

  const reload = useCallback(() => {
    return fetch(`/api/clients/${clientId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) {
          setData(null);
          return;
        }
        setData(d.data);
        // Saving details may fill a gap a reminder was watching.
        announceRemindersChanged();
        const c = d.data.client;
        setForm({
          fullName: c.fullName,
          phone: c.phone,
          idNumber: c.idNumber || '',
          email: c.email || '',
          city: c.city || '',
          address: c.address || '',
          notes: c.notes || '',
        });
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading) {
    return (
      <div className="stack" aria-busy="true">
        <div className="skeleton" style={{ height: 120, borderRadius: 16 }} />
        <div className="skeleton" style={{ height: 160, borderRadius: 16 }} />
      </div>
    );
  }
  if (!data) {
    return (
      <Empty
        icon={<IconUser size={30} />}
        title="הלקוח לא נמצא"
        action={<Link className="button button-secondary" href={'/clients' as never}>לרשימת הלקוחות</Link>}
      >
        ייתכן שנמחק, או שאינו משויך אליכם.
      </Empty>
    );
  }

  const { client, cases, documents, payments, activity } = data;
  const canManage = Boolean(data.canManagePayments);
  const totalBalance = cases.reduce((sum, c) => sum + c.finance.balance, 0);
  const openCases = cases.filter((c) => c.stage !== 'closed');
  const newCase = () => openWizard({ mode: 'case', clientId, clientName: client.fullName });

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.ok === false) {
        toast(d.error || 'השמירה נכשלה', 'error');
        return;
      }
      toast('פרטי הלקוח נשמרו');
      reload();
    } catch {
      toast('אין חיבור לשרת', 'error');
    } finally {
      setSaving(false);
    }
  }

  const missingDetails = missingClientDetails(client);
  const detailReminders = reminders.filter((r) => r.watchKind === 'client-details');

  const tabs: { id: Tab; label: string; count?: number; Icon: typeof IconFile }[] = [
    { id: 'documents', label: 'מסמכים', count: documents.length, Icon: IconFile },
    ...(canManage ? [{ id: 'payments' as Tab, label: 'תשלומים', count: payments.length, Icon: IconCoins }] : []),
    { id: 'details', label: 'פרטים', Icon: IconPencil },
    { id: 'history', label: 'היסטוריה', Icon: IconHistory },
  ];

  return (
    <div>
      <Link href={'/clients' as never} className="back-link">
        <IconArrowRight size={15} /> הלקוחות
      </Link>

      <header className="client-head card">
        <span className="avatar xl">{letters(client.fullName)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="page-eyebrow">
            לקוח <span className="mono">{client.id}</span> · מאז {formatDate(client.createdAt)}
          </div>
          <h1 className="page-title" style={{ margin: '2px 0 6px' }}>{client.fullName}</h1>
          <div className="client-meta">
            <span className="ltr">{client.phone}</span>
            {client.idNumber && <span>ת״ז <span className="ltr">{client.idNumber}</span></span>}
            {client.email && <span className="ltr">{client.email}</span>}
            {(client.city || client.address) && <span>{[client.address, client.city].filter(Boolean).join(', ')}</span>}
          </div>
          {client.notes && <p className="client-notes">{client.notes}</p>}
        </div>
        <div className="client-actions">
          <div className="row" style={{ gap: 6 }}>
            <a className="icon-button contact" href={`tel:${client.phone}`} aria-label={`התקשרות ל${client.fullName}`} title="התקשרות">
              <IconPhone size={18} />
            </a>
            <a
              className="icon-button contact"
              href={`https://wa.me/${whatsappNumber(client.phone)}`}
              target="_blank"
              rel="noreferrer"
              aria-label="וואטסאפ"
              title="וואטסאפ"
            >
              <IconWhatsapp size={18} />
            </a>
            {client.email ? (
              <a className="icon-button contact" href={`mailto:${client.email}`} aria-label="אימייל" title="אימייל">
                <IconMail size={18} />
              </a>
            ) : (
              <button type="button" className="icon-button contact" onClick={() => setTab('details')} title="אין אימייל — הוספה בפרטים" aria-label="הוספת אימייל">
                <IconMail size={18} />
              </button>
            )}
            <RemindButton variant="icon" label="תזכורת על הלקוח" target={{ title: `לחזור ל${client.fullName}`, about: client.fullName, clientId: client.id }} />
            {canManage && (
              <Menu label="פעולות נוספות" trigger={<IconMore size={18} />}>
                <button type="button" className="menu-item" onClick={() => setTab('details')}>
                  <IconPencil size={15} /> עריכת פרטים
                </button>
                <div className="menu-sep" />
                <button type="button" className="menu-item danger" onClick={() => setConfirmDelete(true)}>
                  <IconTrash size={15} /> מחיקת הלקוח
                </button>
              </Menu>
            )}
          </div>
          {totalBalance > 0 && canManage && (
            <button type="button" className="chip amber num" onClick={() => setTab('payments')}>
              יתרה לתשלום {shekel(totalBalance)}
            </button>
          )}
        </div>
      </header>

      {missingDetails.length > 0 && (
        <div className="gap-strip">
          <span>
            <span className="strong">חסרים פרטים:</span> {missingDetails.map((f) => CLIENT_DETAIL_LABELS[f]).join(', ')}
          </span>
          {detailReminders.map((r) => (
            <ReminderChip key={r.id} reminder={r} />
          ))}
          <span className="spacer" />
          <button type="button" className="button button-compact button-secondary" onClick={() => setTab('details')}>
            <IconPencil size={15} /> השלמה עכשיו
          </button>
          {detailReminders.length === 0 && (
            <RemindButton
              label="תזכורת להשלים"
              target={{
                title: `להשלים ${missingDetails.map((f) => CLIENT_DETAIL_LABELS[f]).join(', ')} — ${client.fullName}`,
                about: client.fullName,
                clientId: client.id,
                watch: { kind: 'client-details', fields: missingDetails },
              }}
            />
          )}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <RemindersCard reminders={reminders.filter((r) => r.watchKind !== 'client-details')} />
      </div>

      <section className="client-cases">
        <div className="section-title">
          <h2>תיקים</h2>
          <span className="muted small">
            {cases.length === 0 ? 'אין תיקים' : `${openCases.length} פעילים${cases.length > openCases.length ? ` · ${cases.length - openCases.length} סגורים` : ''}`}
          </span>
        </div>
        <div className="folder-grid">
          {cases.map((c) => (
            <CaseFolder key={c.id} c={c} />
          ))}
          <button type="button" className="folder folder-new" onClick={newCase}>
            <span className="folder-tab none">תיק חדש</span>
            <IconPlus size={20} />
            <span>{cases.length === 0 ? 'פתיחת התיק הראשון של הלקוח' : 'פתיחת תיק נוסף'}</span>
          </button>
        </div>
      </section>

      <div className="tabs" role="tablist" style={{ marginTop: 28 }}>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            <t.Icon size={15} /> {t.label}
            {t.count ? <span className="count">{t.count}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'documents' && (
        <div className="card">
          <DocumentsPanel clientId={clientId} documents={documents} clientContact={{ email: client.email, phone: client.phone }} onChanged={reload} />
        </div>
      )}

      {tab === 'payments' && canManage && <PaymentsTab clientId={clientId} data={data} onChanged={reload} />}

      {tab === 'details' && (
        <form className="card" style={{ maxWidth: 720 }} onSubmit={saveDetails}>
          <div className="card-head">
            <div>
              <div className="card-title">פרטי הלקוח</div>
              <div className="card-sub">הטלפון והאימייל משמשים לשליחת מסמכים ותזכורות ללקוח.</div>
            </div>
          </div>
          <div className="form-grid">
            {EDIT_FIELDS.map(([key, label, required]) => (
              <Field key={key} label={label} required={required}>
                <input
                  value={form[key] ?? ''}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  required={required}
                  type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'}
                  dir={LTR_FIELDS.has(key) ? 'ltr' : undefined}
                  style={LTR_FIELDS.has(key) ? { textAlign: 'right' } : undefined}
                />
              </Field>
            ))}
            <Field label="הערות" full>
              <textarea rows={3} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="button" type="submit" disabled={saving}>{saving ? 'שומר…' : 'שמירת הפרטים'}</button>
          </div>
        </form>
      )}

      {tab === 'history' && (
        <div className="card">
          {activity.length === 0 ? (
            <Empty icon={<IconHistory size={28} />} title="אין עדיין היסטוריה">
              כל העלאה, שינוי שלב ותשלום של הלקוח יירשמו כאן.
            </Empty>
          ) : (
            <ol className="feed">
              {activity.map((a) => (
                <li key={a.id}>
                  <span className="feed-time" title={formatDate(a.at, true)}>{timeAgo(a.at)}</span>
                  {a.caseId ? <Link href={`/cases/${a.caseId}` as never}>{a.summary}</Link> : <span>{a.summary}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {confirmDelete && (
        <DeleteClient
          name={client.fullName}
          counts={{ cases: cases.length, documents: documents.length, payments: payments.length }}
          onClose={() => setConfirmDelete(false)}
          onDeleted={() => {
            toast('הלקוח נמחק');
            router.push('/clients' as never);
          }}
          clientId={clientId}
        />
      )}
    </div>
  );
}

function CaseFolder({ c }: { c: CaseItem }) {
  const config = useConfig();
  const color = companyColor(config, c.company);
  const flagged = Boolean(c.troubleFlag) || isUnderInvestigation(c);
  const phase = phaseOf(c.stage);
  const phaseIndex = PHASES.findIndex((p) => p.id === phase);
  const closed = c.stage === 'closed';
  return (
    <Link
      href={`/cases/${c.id}` as never}
      className={`folder ${flagged ? 'flagged' : ''} ${closed ? 'closed' : ''}`}
      style={color ? ({ '--co': color } as CSSProperties) : undefined}
    >
      <span className={`folder-tab ${color ? '' : 'none'}`}>
        {c.company && c.company !== 'none' ? optionLabel(config.companies, c.company, '') : 'ללא חברה'}
        {c.caseKind === 'renewal' && ' · חידוש'}
      </span>
      <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <div className="folder-title truncate">
          {flagged && <IconFlag size={13} style={{ color: 'var(--red)', marginInlineEnd: 4, verticalAlign: -2 }} />}
          {c.title}
        </div>
        <span className="mono tiny muted">{c.id}</span>
      </div>
      <div className="phase-track" aria-label={`שלב ${phaseIndex + 1} מתוך ${PHASES.length}`}>
        {PHASES.map((p, i) => (
          <span key={p.id} className={i < phaseIndex || closed ? 'done' : i === phaseIndex ? 'now' : ''} />
        ))}
      </div>
      <div className="folder-meta">
        <strong className="ink-2">{stageLabelOf(config, c.stage)}</strong>
        {(c.assignedToName || c.openedByName) && <span>· {c.assignedToName || c.openedByName}</span>}
      </div>
      {flagged && c.troubleNote ? (
        <div className="folder-note red">{c.troubleNote}</div>
      ) : c.nextAction && !closed ? (
        <div className="folder-note">הבא: {c.nextAction}</div>
      ) : null}
      <div className="folder-foot">
        <span className="tiny muted">
          {PAYMENT_STATUS_LABELS[c.finance.status]}
          {c.finance.balance > 0 && <span className="num"> · {shekel(c.finance.balance)}</span>}
        </span>
        {c.missingItems > 0 && !closed && <span className="stamp missing">{c.missingItems} חסרים</span>}
        {closed && <span className="stamp na">סגור</span>}
      </div>
    </Link>
  );
}

function PaymentsTab({ clientId, data, onChanged }: { clientId: string; data: ClientDetail; onChanged: () => void }) {
  const config = useConfig();
  const toast = useToast();
  const { cases, payments } = data;
  const [form, setForm] = useState({
    amount: '',
    method: config.paymentMethods[0]?.value || 'bank-transfer',
    caseId: cases.find((c) => c.finance.balance > 0)?.id || '',
    note: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const fees = cases.reduce((s, c) => s + c.finance.fee, 0);
  const paid = cases.reduce((s, c) => s + c.finance.paid, 0);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('סכום התשלום צריך להיות גדול מאפס');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, caseId: form.caseId || undefined, amount, method: form.method, note: form.note || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) {
        setError(d.error || 'רישום התשלום נכשל');
        return;
      }
      toast(`נרשם תשלום של ${shekel(amount)}`);
      setForm((f) => ({ ...f, amount: '', note: '' }));
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/payments/${id}`, { method: 'DELETE' }).catch(() => null);
    setRemoving(null);
    if (!res?.ok) {
      toast('מחיקת התשלום נכשלה', 'error');
      return;
    }
    toast('התשלום נמחק');
    onChanged();
  }

  const target = payments.find((p) => p.id === removing);

  return (
    <div className="layout-aside">
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">תשלומים שהתקבלו</div>
            <div className="card-sub">
              {fees > 0 ? `שולמו ${shekel(paid)} מתוך ${shekel(fees)} שכר טרחה` : 'לא נקבע שכר טרחה בתיקים'}
            </div>
          </div>
        </div>
        {payments.length === 0 ? (
          <Empty icon={<IconCoins size={28} />} title="עוד לא נרשמו תשלומים">
            תשלום שנרשם כאן משויך לתיק ומעדכן את היתרה שלו.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>תאריך</th>
                  <th>סכום</th>
                  <th>אמצעי</th>
                  <th>תיק</th>
                  <th aria-label="פעולות" />
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="nowrap">{formatDate(p.paidAt)}</td>
                    <td className="num strong">{shekel(p.amount)}</td>
                    <td>{optionLabel(config.paymentMethods, p.method, p.method)}</td>
                    <td>
                      {p.caseId ? (
                        <Link className="text-link" href={`/cases/${p.caseId}` as never}>
                          {cases.find((c) => c.id === p.caseId)?.title || p.caseId}
                        </Link>
                      ) : (
                        <span className="muted">—</span>
                      )}
                      {p.note && <div className="tiny muted">{p.note}</div>}
                    </td>
                    <td style={{ textAlign: 'end' }}>
                      <button type="button" className="icon-button small" onClick={() => setRemoving(p.id)} aria-label="מחיקת התשלום">
                        <IconTrash size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <form className="card" onSubmit={add}>
        <div className="card-title" style={{ marginBottom: 12 }}>רישום תשלום</div>
        <div className="stack" style={{ gap: 12 }}>
          <Field label="סכום (₪)" required>
            <input type="number" inputMode="decimal" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </Field>
          <Field label="אמצעי תשלום">
            <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              {config.paymentMethods.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </Field>
          <Field label="על חשבון תיק">
            <select value={form.caseId} onChange={(e) => setForm({ ...form, caseId: e.target.value })}>
              <option value="">ללא שיוך לתיק</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                  {c.finance.balance > 0 ? ` · יתרה ${shekel(c.finance.balance)}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="הערה">
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="למשל: מספר אסמכתא" />
          </Field>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button" type="submit" disabled={saving}>{saving ? 'שומר…' : 'רישום התשלום'}</button>
        </div>
      </form>

      {target && (
        <Modal
          title="מחיקת תשלום"
          size="narrow"
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button type="button" className="button button-secondary" onClick={() => setRemoving(null)}>ביטול</button>
              <button type="button" className="button button-danger" onClick={() => remove(target.id)}>מחיקת התשלום</button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            התשלום של <strong className="num">{shekel(target.amount)}</strong> מ־{formatDate(target.paidAt)} יימחק, והיתרה בתיק תגדל בהתאם.
          </p>
        </Modal>
      )}
    </div>
  );
}

function DeleteClient({
  clientId,
  name,
  counts,
  onClose,
  onDeleted,
}: {
  clientId: string;
  name: string;
  counts: { cases: number; documents: number; payments: number };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const matches = typed.trim() === name.trim();

  async function remove() {
    setBusy(true);
    setError('');
    const res = await fetch(`/api/clients/${clientId}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) {
      onDeleted();
      return;
    }
    const d = res ? await res.json().catch(() => ({})) : {};
    setError(d.error || 'מחיקת הלקוח נכשלה');
    setBusy(false);
  }

  return (
    <Modal
      title="מחיקת לקוח"
      subtitle="פעולה סופית, אין דרך לשחזר"
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-secondary" onClick={onClose}>ביטול</button>
          <button type="button" className="button button-danger" disabled={!matches || busy} onClick={remove}>
            {busy ? 'מוחק…' : 'מחיקה לצמיתות'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <div className="notice danger">
          <IconFolder size={16} />
          <span>
            יימחקו {counts.cases} תיקים, {counts.documents} מסמכים ו־{counts.payments} תשלומים של {name}.
          </span>
        </div>
        <Field label={`להקליד את שם הלקוח לאישור: ${name}`}>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </Field>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
