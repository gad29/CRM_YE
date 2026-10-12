'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { optionLabel, PAYMENT_STATUS_LABELS, stageLabelOf, type CaseStage, type PaymentMethod } from '@/lib/domain';
import { useConfig } from '@/components/config-provider';

type CaseRow = {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  officeName: string;
  stage: CaseStage;
  finance: { fee: number; paid: number; balance: number; status: 'paid' | 'partial' | 'unpaid' };
};

type PaymentRow = {
  id: string;
  clientId: string;
  caseId?: string;
  amount: number;
  method: PaymentMethod;
  paidAt: string;
  note?: string;
};

function shekel(amount: number) {
  return `₪${amount.toLocaleString('he-IL')}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
}

const FILTERS = [
  { id: 'all', label: 'הכל' },
  { id: 'unpaid', label: 'לא שולם' },
  { id: 'partial', label: 'שולם חלקית' },
  { id: 'paid', label: 'שולם' },
] as const;

export default function PaymentsPage() {
  const config = useConfig();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ amount: '', method: 'bank-transfer', paidAt: '', note: '' });
  const [editError, setEditError] = useState('');

  function reload() {
    Promise.all([
      fetch('/api/cases').then((r) => r.json()),
      fetch('/api/payments').then((r) => r.json()),
    ])
      .then(([casesRes, paymentsRes]) => {
        if (casesRes.ok) setCases(casesRes.data);
        if (paymentsRes.ok) setPayments(paymentsRes.data);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  const withFee = useMemo(() => cases.filter((c) => c.finance.fee > 0 || c.finance.paid > 0), [cases]);
  const filtered = useMemo(
    () => (filter === 'all' ? withFee : withFee.filter((c) => c.finance.status === filter)),
    [withFee, filter],
  );

  const totals = useMemo(() => {
    const fees = withFee.reduce((sum, c) => sum + c.finance.fee, 0);
    const paid = withFee.reduce((sum, c) => sum + c.finance.paid, 0);
    const balance = withFee.reduce((sum, c) => sum + c.finance.balance, 0);
    const thisMonth = payments
      .filter((p) => {
        const d = new Date(p.paidAt);
        const now = new Date();
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((sum, p) => sum + p.amount, 0);
    return { fees, paid, balance, thisMonth };
  }, [withFee, payments]);

  async function deletePayment(paymentId: string) {
    if (!window.confirm('למחוק את התשלום? הסטטוס של התיק יתעדכן בהתאם (למשל חזרה ל"לא שולם").')) return;
    await fetch(`/api/payments/${paymentId}`, { method: 'DELETE' });
    reload();
  }

  function startEdit(payment: PaymentRow) {
    setEditingId(payment.id);
    setEditError('');
    setEditForm({
      amount: String(payment.amount),
      method: payment.method,
      paidAt: payment.paidAt.slice(0, 10),
      note: payment.note || '',
    });
  }

  async function saveEdit(paymentId: string) {
    setEditError('');
    const amount = Number(editForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setEditError('סכום חייב להיות חיובי — למחיקת התשלום השתמש בכפתור המחיקה');
      return;
    }
    const res = await fetch(`/api/payments/${paymentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount,
        method: editForm.method,
        paidAt: editForm.paidAt ? new Date(editForm.paidAt).toISOString() : undefined,
        note: editForm.note,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setEditError(data.error || 'העדכון נכשל');
      return;
    }
    setEditingId(null);
    reload();
  }

  return (
    <div>
      <div className="hero">
        <div>
          <p className="eyebrow">כספים</p>
          <h1 style={{ margin: '6px 0 4px' }}>לוח תשלומים</h1>
          <p className="muted" style={{ margin: 0 }}>מעקב גבייה לפי תיק — מי שילם, מי חייב, וכמה.</p>
        </div>
      </div>

      <div className="pipeline-cards" style={{ marginBottom: 20 }}>
        <div className="pipeline-card pc-active">
          <div className="pc-label">סה"כ שכר טרחה</div>
          <div className="pc-count" style={{ fontSize: 32 }}>{shekel(totals.fees)}</div>
        </div>
        <div className="pipeline-card pc-done">
          <div className="pc-label">נגבה</div>
          <div className="pc-count" style={{ fontSize: 32 }}>{shekel(totals.paid)}</div>
        </div>
        <div className="pipeline-card pc-stuck">
          <div className="pc-label">יתרה לגבייה</div>
          <div className="pc-count" style={{ fontSize: 32 }}>{shekel(totals.balance)}</div>
        </div>
        <div className="pipeline-card pc-new">
          <div className="pc-label">התקבל החודש</div>
          <div className="pc-count" style={{ fontSize: 32 }}>{shekel(totals.thisMonth)}</div>
        </div>
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="section-heading">
            <h3 style={{ margin: 0 }}>מצב גבייה לפי תיק</h3>
          </div>
          <div className="tab-bar" style={{ marginBottom: 14 }}>
            {FILTERS.map(({ id, label }) => (
              <button key={id} type="button" className={`tab ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
          {loading ? (
            <p className="muted">טוען…</p>
          ) : filtered.length === 0 ? (
            <p className="muted">אין תיקים בסינון זה.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>תיק</th>
                  <th>שכ"ט</th>
                  <th>שולם</th>
                  <th>יתרה</th>
                  <th>סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link className="text-link" href={`/cases/${c.id}` as never}>
                        {c.clientName} · {c.title}
                      </Link>
                      <span className="muted" style={{ display: 'block', fontSize: 11 }}>{stageLabelOf(config, c.stage)}</span>
                    </td>
                    <td>{shekel(c.finance.fee)}</td>
                    <td>{shekel(c.finance.paid)}</td>
                    <td style={{ color: c.finance.balance > 0 ? 'var(--danger)' : 'var(--good)', fontWeight: 700 }}>
                      {shekel(c.finance.balance)}
                    </td>
                    <td>
                      <span className={`doc-status-badge ${c.finance.status === 'paid' ? 'approved' : c.finance.status === 'partial' ? 'under-review' : 'resubmit-needed'}`}>
                        {PAYMENT_STATUS_LABELS[c.finance.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="section-heading">
            <h3 style={{ margin: 0 }}>תשלומים אחרונים</h3>
          </div>
          {payments.length === 0 ? (
            <p className="muted">לא נרשמו תשלומים. רישום תשלום מתבצע מדף הלקוח או מדף התיק.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>תאריך</th>
                  <th>סכום</th>
                  <th>אמצעי</th>
                  <th>תיק</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {payments.slice(0, 30).map((p) => {
                  const relatedCase = cases.find((c) => c.id === p.caseId);
                  if (editingId === p.id) {
                    return (
                      <tr key={p.id} style={{ background: 'var(--panel)' }}>
                        <td>
                          <input
                            type="date"
                            value={editForm.paidAt}
                            onChange={(e) => setEditForm({ ...editForm, paidAt: e.target.value })}
                            style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', width: 130 }}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editForm.amount}
                            onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                            style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', width: 90 }}
                          />
                        </td>
                        <td>
                          <select
                            value={editForm.method}
                            onChange={(e) => setEditForm({ ...editForm, method: e.target.value })}
                            style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)' }}
                          >
                            {config.paymentMethods.map((m) => (
                              <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            placeholder="הערה"
                            value={editForm.note}
                            onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                            style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', width: '100%' }}
                          />
                          {editError && <span className="form-error" style={{ display: 'block', fontSize: 11 }}>{editError}</span>}
                        </td>
                        <td>
                          <div className="doc-actions">
                            <button type="button" className="doc-action-btn approve" onClick={() => saveEdit(p.id)}>✓ שמור</button>
                            <button type="button" className="doc-action-btn" onClick={() => setEditingId(null)}>ביטול</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={p.id}>
                      <td>{formatDate(p.paidAt)}</td>
                      <td><strong>{shekel(p.amount)}</strong>{p.note && <span className="muted" style={{ display: 'block', fontSize: 11 }}>{p.note}</span>}</td>
                      <td>{optionLabel(config.paymentMethods, p.method, p.method)}</td>
                      <td>
                        {relatedCase ? (
                          <Link className="text-link" href={`/cases/${relatedCase.id}` as never}>
                            {relatedCase.clientName} · {relatedCase.title}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <div className="doc-actions">
                          <button type="button" className="doc-action-btn" onClick={() => startEdit(p)}>עריכה</button>
                          <button type="button" className="doc-action-btn reject" onClick={() => deletePayment(p.id)}>מחק</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
