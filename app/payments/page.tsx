'use client';

import '@/app/styles/tools.css';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { optionLabel, PAYMENT_STATUS_LABELS, stageLabelOf, type CaseStage, type PaymentStatus } from '@/lib/domain';
import { useConfig } from '@/components/config-provider';
import { CompanyChip } from '@/components/company-chip';
import { Empty, Field, PageHead, formatDate, shekel } from '@/components/ui/bits';
import { Modal } from '@/components/ui/overlay';
import { useToast } from '@/components/ui/toast';
import { IconCoins, IconPencil, IconPlus, IconSearch, IconTrash } from '@/components/ui/icons';

type CaseRow = {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  company?: string;
  stage: CaseStage;
  finance: { fee: number; paid: number; balance: number; status: PaymentStatus; overridden?: boolean };
};

type PaymentRow = {
  id: string;
  clientId: string;
  caseId?: string;
  amount: number;
  method: string;
  paidAt: string;
  note?: string;
};

type Filter = 'open' | 'awaiting' | 'paid' | 'all';

const STATUS_TONE: Record<PaymentStatus, string> = { unpaid: 'red', partial: 'amber', paid: 'green' };

function todayInput() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type PaymentForm = { caseId: string; amount: string; method: string; paidAt: string; note: string };

export default function PaymentsPage() {
  const config = useConfig();
  const toast = useToast();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<PaymentRow | 'new' | null>(null);
  const [form, setForm] = useState<PaymentForm>({ caseId: '', amount: '', method: '', paidAt: todayInput(), note: '' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAllPayments, setShowAllPayments] = useState(false);

  const reload = useCallback(() => {
    Promise.all([fetch('/api/cases').then((r) => r.json()), fetch('/api/payments').then((r) => r.json())])
      .then(([casesRes, paymentsRes]) => {
        if (casesRes.ok) setCases(casesRes.data);
        if (paymentsRes.ok) setPayments(paymentsRes.data);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  useEffect(reload, [reload]);

  const caseById = useMemo(() => new Map(cases.map((c) => [c.id, c])), [cases]);
  const withFee = useMemo(() => cases.filter((c) => c.finance.fee > 0 || c.finance.paid > 0 || c.stage === 'awaiting-payment'), [cases]);
  const awaiting = useMemo(() => withFee.filter((c) => c.stage === 'awaiting-payment' && c.finance.status !== 'paid'), [withFee]);

  const totals = useMemo(() => {
    const now = new Date();
    return {
      fees: withFee.reduce((sum, c) => sum + c.finance.fee, 0),
      paid: withFee.reduce((sum, c) => sum + c.finance.paid, 0),
      balance: withFee.reduce((sum, c) => sum + c.finance.balance, 0),
      openCount: withFee.filter((c) => c.finance.balance > 0).length,
      awaitingBalance: awaiting.reduce((sum, c) => sum + c.finance.balance, 0),
      thisMonth: payments
        .filter((p) => {
          const d = new Date(p.paidAt);
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        })
        .reduce((sum, p) => sum + p.amount, 0),
    };
  }, [withFee, awaiting, payments]);

  const rows = useMemo(() => {
    const q = query.trim();
    let list = withFee;
    if (filter === 'open') list = list.filter((c) => c.finance.balance > 0);
    else if (filter === 'awaiting') list = awaiting;
    else if (filter === 'paid') list = list.filter((c) => c.finance.status === 'paid');
    if (q) list = list.filter((c) => c.clientName.includes(q) || c.title.includes(q));
    // Cases waiting for payment first, then the biggest balance.
    return [...list].sort(
      (a, b) =>
        Number(b.stage === 'awaiting-payment') - Number(a.stage === 'awaiting-payment') || b.finance.balance - a.finance.balance,
    );
  }, [withFee, awaiting, filter, query]);

  const filterOptions: { value: Filter; label: string; n: number }[] = [
    { value: 'open', label: 'יתרה פתוחה', n: totals.openCount },
    { value: 'awaiting', label: 'ממתינים לתשלום', n: awaiting.length },
    { value: 'paid', label: 'שולם', n: withFee.filter((c) => c.finance.status === 'paid').length },
    { value: 'all', label: 'הכל', n: withFee.length },
  ];

  function openNew(caseRow?: CaseRow) {
    setForm({
      caseId: caseRow?.id || '',
      amount: caseRow && caseRow.finance.balance > 0 ? String(caseRow.finance.balance) : '',
      method: config.paymentMethods[0]?.value || 'other',
      paidAt: todayInput(),
      note: '',
    });
    setFormError('');
    setEditing('new');
  }

  function openEdit(p: PaymentRow) {
    setForm({ caseId: p.caseId || '', amount: String(p.amount), method: p.method, paidAt: p.paidAt.slice(0, 10), note: p.note || '' });
    setFormError('');
    setEditing(p);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError('הסכום חייב להיות גדול מאפס');
      return;
    }
    const caseRow = caseById.get(form.caseId);
    if (editing === 'new' && !caseRow) {
      setFormError('בחרו לאיזה תיק שייך התשלום');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const isNew = editing === 'new';
      const res = await fetch(isNew ? '/api/payments' : `/api/payments/${editing.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isNew ? { clientId: caseRow!.clientId, caseId: caseRow!.id } : {}),
          amount,
          method: form.method,
          paidAt: form.paidAt ? new Date(form.paidAt).toISOString() : undefined,
          note: form.note,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFormError(data.error || 'התשלום לא נשמר — נסו שוב');
        return;
      }
      toast(isNew ? `נרשם תשלום של ${shekel(amount)}` : 'התשלום עודכן');
      setEditing(null);
      reload();
    } catch {
      setFormError('אין חיבור לשרת — התשלום לא נשמר');
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: PaymentRow) {
    if (!window.confirm(`למחוק את התשלום של ${shekel(p.amount)}? היתרה בתיק תחושב מחדש.`)) return;
    const res = await fetch(`/api/payments/${p.id}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) {
      toast('התשלום נמחק');
      setEditing(null);
    } else toast('המחיקה נכשלה', 'error');
    reload();
  }

  const recent = showAllPayments ? payments : payments.slice(0, 12);
  const selectedCase = caseById.get(form.caseId);
  const editingPayment = editing && editing !== 'new' ? editing : null;

  return (
    <>
      <PageHead
        title="תשלומים"
        sub="מי שילם, מי חייב וכמה — לפי תיק."
        actions={
          <button type="button" className="button" onClick={() => openNew()}>
            <IconPlus size={16} /> רישום תשלום
          </button>
        }
      />

      <div className="tray-row four" style={{ marginBottom: 22 }}>
        <div className="tray red">
          <span className="tray-label">יתרה לגבייה</span>
          <span className="tray-count money">{shekel(totals.balance)}</span>
          <span className="tray-hint">ב-{totals.openCount} תיקים</span>
        </div>
        <button type="button" className="tray amber" onClick={() => setFilter('awaiting')} style={{ textAlign: 'start', cursor: 'pointer' }}>
          <span className="tray-label">ממתינים לתשלום</span>
          <span className="tray-count money">{awaiting.length}</span>
          <span className="tray-hint">{awaiting.length ? `${shekel(totals.awaitingBalance)} — אושרו וממתינים לגבייה` : 'אין תיקים בשלב הזה'}</span>
        </button>
        <div className="tray green">
          <span className="tray-label">התקבל החודש</span>
          <span className="tray-count money">{shekel(totals.thisMonth)}</span>
          <span className="tray-hint">{new Date().toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}</span>
        </div>
        <div className="tray">
          <span className="tray-label">נגבה מתוך שכר הטרחה</span>
          <span className="tray-count money">{shekel(totals.paid)}</span>
          <span className="tray-hint">מתוך {shekel(totals.fees)}</span>
        </div>
      </div>

      <section className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <div className="row" style={{ gap: 6 }}>
            {filterOptions.map((o) => (
              <button key={o.value} type="button" className={`filter-chip ${filter === o.value ? 'on' : ''}`} onClick={() => setFilter(o.value)} aria-pressed={filter === o.value}>
                {o.label} <span className="n">{o.n}</span>
              </button>
            ))}
          </div>
          <label className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <IconSearch size={16} className="muted" />
            <input className="input" style={{ height: 34, width: 200 }} placeholder="חיפוש לקוח או תיק" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="חיפוש לקוח או תיק" />
          </label>
        </div>

        {loading ? (
          <div className="stack" style={{ gap: 8 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ height: 44 }} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Empty icon={<IconCoins size={32} />} title={filter === 'awaiting' ? 'אין תיקים שממתינים לתשלום' : filter === 'open' ? 'אין יתרות פתוחות' : 'אין תיקים להצגה'}>
            {query ? 'נסו חיפוש אחר.' : 'שכר טרחה נקבע בדף התיק; תשלומים נרשמים כאן או מהתיק עצמו.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>תיק</th>
                  <th>שלב</th>
                  <th>שכר טרחה</th>
                  <th>שולם</th>
                  <th>יתרה</th>
                  <th>מצב</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const pct = c.finance.fee > 0 ? Math.min(100, Math.round((c.finance.paid / c.finance.fee) * 100)) : c.finance.status === 'paid' ? 100 : 0;
                  return (
                    <tr key={c.id} className={c.stage === 'awaiting-payment' ? 'awaiting' : ''}>
                      <td>
                        <Link className="list-title" href={`/cases/${c.id}` as never}>
                          {c.clientName}
                        </Link>
                        <div className="row small muted" style={{ gap: 8, marginTop: 2 }}>
                          <span className="truncate">{c.title}</span>
                          <CompanyChip company={c.company} />
                        </div>
                      </td>
                      <td className="small">
                        {c.stage === 'awaiting-payment' ? <span className="chip amber">{stageLabelOf(config, c.stage)}</span> : <span className="ink-2">{stageLabelOf(config, c.stage)}</span>}
                      </td>
                      <td className="money">{shekel(c.finance.fee)}</td>
                      <td>
                        <span className="money">{shekel(c.finance.paid)}</span>
                        <div className="pay-progress" aria-hidden="true">
                          <span style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                      <td className={`money ${c.finance.balance > 0 ? 'due' : 'clear'}`}>{shekel(c.finance.balance)}</td>
                      <td>
                        <span className={`chip ${STATUS_TONE[c.finance.status]}`} title={c.finance.overridden ? 'נקבע ידנית בתיק' : undefined}>
                          {PAYMENT_STATUS_LABELS[c.finance.status]}
                          {c.finance.overridden ? ' *' : ''}
                        </span>
                      </td>
                      <td style={{ textAlign: 'end' }}>
                        {c.finance.balance > 0 && (
                          <button type="button" className="button button-secondary button-compact" onClick={() => openNew(c)}>
                            רישום תשלום
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">תשלומים שהתקבלו</div>
            <div className="card-sub">האחרונים קודם. לחיצה על שורה פותחת עריכה.</div>
          </div>
        </div>
        {payments.length === 0 ? (
          <Empty title="עוד לא נרשמו תשלומים">כשלקוח משלם, רושמים את התשלום כאן או בדף התיק.</Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>תאריך</th>
                    <th>סכום</th>
                    <th>אמצעי</th>
                    <th>תיק</th>
                    <th>הערה</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {recent.map((p) => {
                    const related = p.caseId ? caseById.get(p.caseId) : undefined;
                    return (
                      <tr key={p.id} className="clickable" onClick={() => openEdit(p)}>
                        <td className="nowrap">{formatDate(p.paidAt)}</td>
                        <td className="money strong">{shekel(p.amount)}</td>
                        <td>{optionLabel(config.paymentMethods, p.method, p.method)}</td>
                        <td>
                          {related ? (
                            <Link className="text-link" href={`/cases/${related.id}` as never} onClick={(e) => e.stopPropagation()}>
                              {related.clientName} · {related.title}
                            </Link>
                          ) : (
                            <Link className="text-link" href={`/clients/${p.clientId}` as never} onClick={(e) => e.stopPropagation()}>
                              לדף הלקוח
                            </Link>
                          )}
                        </td>
                        <td className="small muted truncate" style={{ maxWidth: 220 }}>
                          {p.note}
                        </td>
                        <td style={{ textAlign: 'end' }}>
                          <IconPencil size={15} className="muted" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {payments.length > 12 && (
              <button type="button" className="button button-quiet button-compact" style={{ marginTop: 10 }} onClick={() => setShowAllPayments((v) => !v)}>
                {showAllPayments ? 'הצגת פחות' : `הצגת כל ${payments.length} התשלומים`}
              </button>
            )}
          </>
        )}
      </section>

      {editing && (
        <Modal
          title={editing === 'new' ? 'רישום תשלום' : 'עריכת תשלום'}
          subtitle={selectedCase ? `${selectedCase.clientName} · ${selectedCase.title}` : undefined}
          size="narrow"
          onClose={() => setEditing(null)}
          footer={
            <>
              {editingPayment && (
                <button type="button" className="button button-danger button-compact" style={{ marginInlineEnd: 'auto' }} onClick={() => remove(editingPayment)}>
                  <IconTrash size={15} /> מחיקה
                </button>
              )}
              <button type="button" className="button button-secondary" onClick={() => setEditing(null)}>
                ביטול
              </button>
              <button type="submit" form="payment-form" className="button" disabled={saving}>
                {saving ? 'שומר…' : editing === 'new' ? 'רישום התשלום' : 'שמירת השינויים'}
              </button>
            </>
          }
        >
          <form id="payment-form" className="form-grid" onSubmit={submit}>
            {editing === 'new' && (
              <Field label="תיק" required full>
                <select
                  value={form.caseId}
                  onChange={(e) => {
                    const c = caseById.get(e.target.value);
                    setForm({ ...form, caseId: e.target.value, amount: c && c.finance.balance > 0 ? String(c.finance.balance) : form.amount });
                  }}
                  required
                >
                  <option value="">בחרו תיק…</option>
                  {[...cases]
                    .sort((a, b) => b.finance.balance - a.finance.balance || a.clientName.localeCompare(b.clientName, 'he'))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.clientName} · {c.title}
                        {c.finance.balance > 0 ? ` — יתרה ${shekel(c.finance.balance)}` : ''}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            <Field label="סכום (₪)" required hint={selectedCase && editing === 'new' && selectedCase.finance.balance > 0 ? `יתרה בתיק: ${shekel(selectedCase.finance.balance)}` : undefined}>
              <input type="number" min="0.01" step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            </Field>
            <Field label="תאריך">
              <input type="date" value={form.paidAt} onChange={(e) => setForm({ ...form, paidAt: e.target.value })} />
            </Field>
            <Field label="אמצעי תשלום" full>
              <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                {config.paymentMethods.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
                {form.method && !config.paymentMethods.some((m) => m.value === form.method) && <option value={form.method}>{form.method}</option>}
              </select>
            </Field>
            <Field label="הערה" full>
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="למשל: מספר אסמכתא" />
            </Field>
            {formError && (
              <p className="form-error full" role="alert">
                {formError}
              </p>
            )}
          </form>
        </Modal>
      )}
    </>
  );
}
