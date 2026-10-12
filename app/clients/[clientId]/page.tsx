'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useState } from 'react';
import { DocumentsPanel, type DocumentItem } from '@/components/documents-panel';
import {
  optionLabel,
  PAYMENT_STATUS_LABELS,
  stageLabelOf,
  type CaseStage,
  type PaymentMethod,
} from '@/lib/domain';
import { useConfig } from '@/components/config-provider';

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
  cases: Array<{
    id: string;
    title: string;
    stage: CaseStage;
    officeName?: string;
    office: string;
    officeOther?: string;
    missingItems: number;
    troubleFlag?: boolean;
    assignedToName?: string;
    openedByName?: string;
    finance: { fee: number; paid: number; balance: number; status: 'paid' | 'partial' | 'unpaid' };
  }>;
  documents: DocumentItem[];
  payments: Array<{ id: string; amount: number; method: PaymentMethod; paidAt: string; caseId?: string; note?: string }>;
  activity: Array<{ id: string; summary: string; at: string }>;
  canManagePayments?: boolean;
};

function shekel(amount: number) {
  return `₪${amount.toLocaleString('he-IL')}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
}

const TABS = [
  { id: 'cases', label: 'תיקים' },
  { id: 'documents', label: 'תיקיית מסמכים' },
  { id: 'payments', label: 'תשלומים' },
  { id: 'details', label: 'פרטי לקוח' },
  { id: 'activity', label: 'פעילות' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function ClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const router = useRouter();
  const config = useConfig();
  const { clientId } = use(params);
  const [data, setData] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>('cases');
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [payForm, setPayForm] = useState({ amount: '', method: 'bank-transfer', caseId: '', note: '' });
  const [payError, setPayError] = useState('');

  const reload = useCallback(() => {
    fetch(`/api/clients/${clientId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setData(d.data);
          const c = d.data.client;
          setEditForm({
            fullName: c.fullName,
            phone: c.phone,
            idNumber: c.idNumber || '',
            email: c.email || '',
            city: c.city || '',
            address: c.address || '',
            notes: c.notes || '',
          });
        }
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading) return <div className="card muted" style={{ padding: 24 }}>טוען לקוח…</div>;
  if (!data) return <div className="card muted" style={{ padding: 24 }}>הלקוח לא נמצא.</div>;

  const { client, cases, documents, payments, activity } = data;
  const totalBalance = cases.reduce((sum, c) => sum + c.finance.balance, 0);
  const canManage = data.canManagePayments;

  async function deleteThisClient() {
    if (!window.confirm(`למחוק את הלקוח "${client.fullName}"?\nכל התיקים, המסמכים והתשלומים שלו יימחקו לצמיתות.`)) return;
    if (!window.confirm('אישור סופי — הפעולה בלתי הפיכה. למחוק לקוח וכל הנתונים שלו?')) return;
    const res = await fetch(`/api/clients/${clientId}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/clients' as never);
    } else {
      const d = await res.json().catch(() => ({}));
      window.alert(d.error || 'מחיקת הלקוח נכשלה');
    }
  }

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSavedNote(false);
    try {
      await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      setSavedNote(true);
      reload();
    } finally {
      setSaving(false);
    }
  }

  async function addPayment(event: React.FormEvent) {
    event.preventDefault();
    setPayError('');
    const amount = Number(payForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPayError('נא להזין סכום חיובי');
      return;
    }
    const res = await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        caseId: payForm.caseId || undefined,
        amount,
        method: payForm.method,
        note: payForm.note || undefined,
      }),
    });
    const result = await res.json();
    if (!res.ok || !result.ok) {
      setPayError(result.error || 'רישום התשלום נכשל');
      return;
    }
    setPayForm({ amount: '', method: 'bank-transfer', caseId: '', note: '' });
    reload();
  }

  async function deletePayment(paymentId: string) {
    if (!window.confirm('למחוק את התשלום?')) return;
    await fetch(`/api/payments/${paymentId}`, { method: 'DELETE' });
    reload();
  }

  return (
    <div>
      <Link className="case-back-link" href="/clients">← כל הלקוחות</Link>
      <div className="hero">
        <div>
          <span className="case-id-badge">{client.id}</span>
          <h1 style={{ margin: '6px 0 4px' }}>{client.fullName}</h1>
          <p className="muted" style={{ margin: 0 }}>
            <span dir="ltr">{client.phone}</span>
            {client.email && <> · <span dir="ltr">{client.email}</span></>}
            {client.city && <> · {client.city}</>}
          </p>
        </div>
        <div className="hero-actions">
          {totalBalance > 0 && <span className="badge warn">יתרה לתשלום: {shekel(totalBalance)}</span>}
          <Link className="button" href={`/cases?new=1&clientId=${clientId}` as never}>+ תיק חדש</Link>
          {canManage && (
            <button type="button" className="button button-secondary button-compact danger-btn" onClick={deleteThisClient} title="מחיקת הלקוח">
              🗑 מחק לקוח
            </button>
          )}
        </div>
      </div>

      <div className="tab-bar">
        {TABS.filter(({ id }) => id !== 'payments' || data.canManagePayments).map(({ id, label }) => (
          <button key={id} type="button" className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {label}
            {id === 'documents' && documents.length > 0 && ` (${documents.length})`}
            {id === 'cases' && cases.length > 0 && ` (${cases.length})`}
          </button>
        ))}
      </div>

      {tab === 'cases' && (
        <div className="office-case-list">
          {cases.length === 0 && (
            <div className="card muted" style={{ padding: 24 }}>אין תיקים ללקוח זה. פתח תיק חדש כדי להתחיל.</div>
          )}
          {cases.map((c) => (
            <Link key={c.id} className={`case-list-item ${c.troubleFlag ? 'case-trouble' : ''}`} href={`/cases/${c.id}` as never}>
              <span className="cli-name">{c.troubleFlag && '🚩 '}{c.title}</span>
              <span className="cli-stage">{stageLabelOf(config, c.stage)}</span>
              <span className="cli-meta">
                <span>{c.officeName}</span>
                {(c.assignedToName || c.openedByName) && <span>· 👤 {c.assignedToName || c.openedByName}</span>}
                {c.missingItems > 0 && <span className="cli-missing">· {c.missingItems} מסמכים חסרים</span>}
                <span>· {PAYMENT_STATUS_LABELS[c.finance.status]}{c.finance.balance > 0 && ` (יתרה ${shekel(c.finance.balance)})`}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {tab === 'documents' && (
        <div className="card">
          <DocumentsPanel clientId={clientId} documents={documents} clientContact={{ email: client.email, phone: client.phone }} onChanged={reload} />
        </div>
      )}

      {tab === 'payments' && (
        <div className="grid cols-2" style={{ alignItems: 'start' }}>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>תשלומים שהתקבלו</h3>
            {payments.length === 0 ? (
              <p className="muted">לא נרשמו תשלומים.</p>
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
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>{formatDate(p.paidAt)}</td>
                      <td><strong>{shekel(p.amount)}</strong></td>
                      <td>{optionLabel(config.paymentMethods, p.method, p.method)}</td>
                      <td>{p.caseId ? cases.find((c) => c.id === p.caseId)?.title || p.caseId : '—'}</td>
                      <td>
                        <button type="button" className="doc-action-btn reject" onClick={() => deletePayment(p.id)}>מחק</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="card nested-card">
            <h3 style={{ marginTop: 0 }}>רישום תשלום</h3>
            <form onSubmit={addPayment}>
              <div className="field">
                <label>סכום (₪) *</label>
                <input type="number" min="0" step="0.01" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} required />
              </div>
              <div className="field">
                <label>אמצעי תשלום</label>
                <select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                  {config.paymentMethods.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>שיוך לתיק</label>
                <select value={payForm.caseId} onChange={(e) => setPayForm({ ...payForm, caseId: e.target.value })}>
                  <option value="">ללא שיוך</option>
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>הערה</label>
                <input value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} />
              </div>
              {payError && <p className="form-error">{payError}</p>}
              <button className="button" type="submit">שמור תשלום</button>
            </form>
          </div>
        </div>
      )}

      {tab === 'details' && (
        <div className="card" style={{ maxWidth: 640 }}>
          <form onSubmit={saveEdit}>
            <div className="section-heading">
              <h3 style={{ margin: 0 }}>פרטי לקוח</h3>
              <span className="muted" style={{ fontSize: 12 }}>הצטרף {formatDate(client.createdAt)}</span>
            </div>
            <div className="form-grid cols-2">
              {(
                [
                  ['fullName', 'שם מלא'],
                  ['phone', 'טלפון'],
                  ['idNumber', 'תעודת זהות'],
                  ['email', 'אימייל'],
                  ['city', 'עיר'],
                  ['address', 'כתובת'],
                ] as const
              ).map(([key, label]) => (
                <div className="field" key={key}>
                  <label>{label}</label>
                  <input value={editForm[key] ?? ''} onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })} />
                </div>
              ))}
            </div>
            <div className="field">
              <label>הערות</label>
              <textarea rows={3} value={editForm.notes ?? ''} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="button" type="submit" disabled={saving}>{saving ? 'שומר…' : 'שמור שינויים'}</button>
              {savedNote && <span className="text-feedback-success" style={{ fontWeight: 600 }}>✓ נשמר</span>}
            </div>
          </form>
        </div>
      )}

      {tab === 'activity' && (
        <div className="card">
          {activity.length === 0 ? (
            <p className="muted">אין פעילות.</p>
          ) : (
            <div className="timeline">
              {activity.map((entry) => (
                <div key={entry.id} className="step">
                  <div className="muted" style={{ fontSize: 11 }}>{formatDate(entry.at)}</div>
                  <div style={{ fontSize: 14 }}>{entry.summary}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
