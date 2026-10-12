'use client';

import { useEffect, useState } from 'react';
import { PasswordInput } from '@/components/password-input';

type AdminRow = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  active: boolean;
  createdAt: string;
};

function AdminsSection() {
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [rootEmail, setRootEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  function reload() {
    fetch('/api/admins')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setAdmins(d.data.admins);
          setRootEmail(d.data.rootEmail);
        }
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function addAdmin(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await fetch('/api/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'הוספת המנהל נכשלה');
        return;
      }
      setForm({ name: '', email: '', password: '', phone: '' });
      setShowAdd(false);
      reload();
    } catch {
      setError('שגיאת תקשורת');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(admin: AdminRow) {
    if (!admin.active || window.confirm(`להשבית את המנהל ${admin.name}? הוא לא יוכל להתחבר עד שיופעל מחדש.`)) {
      setBusy(admin.id);
      try {
        await fetch(`/api/admins/${admin.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: !admin.active }),
        });
        reload();
      } finally {
        setBusy(null);
      }
    }
  }

  async function resetPassword(admin: AdminRow) {
    const password = window.prompt(`סיסמה חדשה עבור ${admin.name} (8 תווים לפחות):`);
    if (!password) return;
    setBusy(admin.id);
    try {
      const res = await fetch(`/api/admins/${admin.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      window.alert(res.ok && data.ok ? 'הסיסמה עודכנה' : data.error || 'איפוס הסיסמה נכשל');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="section-heading">
        <h3 style={{ margin: 0 }}>מנהלים</h3>
        <button type="button" className="button button-compact" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? '✕ סגור' : '+ מנהל נוסף'}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
        מנהל נוסף מתחבר עם אימייל וסיסמה ומקבל הרשאות מלאות — בדיוק כמו המנהל הראשי.
      </p>

      {showAdd && (
        <form onSubmit={addAdmin} className="nested-card card" style={{ marginBottom: 14 }}>
          <div className="form-grid cols-2">
            <div className="field">
              <label>שם מלא *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="field">
              <label>אימייל (לכניסה) *</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required dir="ltr" style={{ textAlign: 'right' }} />
            </div>
            <div className="field">
              <label>סיסמה (8 תווים לפחות) *</label>
              <PasswordInput value={form.password} onChange={(v) => setForm({ ...form, password: v })} required minLength={8} autoComplete="new-password" />
            </div>
            <div className="field">
              <label>טלפון (לתזכורות ואיפוס סיסמה בוואטסאפ)</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" style={{ textAlign: 'right' }} placeholder="972501234567" />
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
          <button className="button" type="submit" disabled={saving}>
            {saving ? 'מוסיף…' : 'הוסף מנהל'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="muted">טוען…</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>שם</th>
              <th>אימייל</th>
              <th>סטטוס</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>מנהל ראשי</strong></td>
              <td dir="ltr" style={{ textAlign: 'right' }}>{rootEmail}</td>
              <td><span className="doc-status-badge approved">פעיל</span></td>
              <td><span className="muted" style={{ fontSize: 11 }}>מוגדר בקובץ ההגדרות בשרת</span></td>
            </tr>
            {admins.map((a) => (
              <tr key={a.id} style={{ opacity: a.active ? 1 : 0.55 }}>
                <td>
                  <strong>{a.name}</strong>
                  {a.phone && <span className="muted" style={{ display: 'block', fontSize: 11 }} dir="ltr">{a.phone}</span>}
                </td>
                <td dir="ltr" style={{ textAlign: 'right' }}>{a.email}</td>
                <td>
                  <span className={`doc-status-badge ${a.active ? 'approved' : 'not-applicable'}`}>
                    {a.active ? 'פעיל' : 'מושבת'}
                  </span>
                </td>
                <td>
                  <div className="doc-actions">
                    <button type="button" className="doc-action-btn" disabled={busy === a.id} onClick={() => resetPassword(a)}>
                      איפוס סיסמה
                    </button>
                    <button
                      type="button"
                      className={`doc-action-btn ${a.active ? 'reject' : 'approve'}`}
                      disabled={busy === a.id}
                      onClick={() => toggleActive(a)}
                    >
                      {a.active ? 'השבת' : 'הפעל'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

type WorkerRow = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  active: boolean;
  openCases: number;
  createdAt: string;
};

export default function WorkersPage() {
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  function reload() {
    fetch('/api/workers')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setWorkers(d.data);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function addWorker(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await fetch('/api/workers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'הוספת העובד נכשלה');
        return;
      }
      setForm({ name: '', email: '', password: '', phone: '' });
      reload();
    } catch {
      setError('שגיאת תקשורת');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(worker: WorkerRow) {
    setBusy(worker.id);
    try {
      await fetch(`/api/workers/${worker.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !worker.active }),
      });
      reload();
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword(worker: WorkerRow) {
    const password = window.prompt(`סיסמה חדשה עבור ${worker.name} (8 תווים לפחות):`);
    if (!password) return;
    setBusy(worker.id);
    try {
      const res = await fetch(`/api/workers/${worker.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) window.alert(data.error || 'איפוס הסיסמה נכשל');
      else window.alert('הסיסמה עודכנה');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="hero">
        <div>
          <p className="eyebrow">צוות</p>
          <h1 style={{ margin: '6px 0 4px' }}>עובדים ומנהלים</h1>
          <p className="muted" style={{ margin: 0 }}>
            לכל עובד כניסה משלו (אימייל + סיסמה). עובד רואה רק תיקים שהוא פתח או שתויכו אליו; מנהל רואה הכל.
          </p>
        </div>
      </div>

      <AdminsSection />

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>עובדים במערכת</h3>
          {loading ? (
            <p className="muted">טוען…</p>
          ) : workers.length === 0 ? (
            <p className="muted">אין עדיין עובדים. הוסף עובד ראשון בטופס משמאל.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>שם</th>
                  <th>אימייל</th>
                  <th>תיקים פתוחים</th>
                  <th>סטטוס</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {workers.map((w) => (
                  <tr key={w.id} style={{ opacity: w.active ? 1 : 0.55 }}>
                    <td>
                      <strong>{w.name}</strong>
                      {w.phone && <span className="muted" style={{ display: 'block', fontSize: 11 }} dir="ltr">{w.phone}</span>}
                    </td>
                    <td dir="ltr" style={{ textAlign: 'right' }}>{w.email}</td>
                    <td>{w.openCases}</td>
                    <td>
                      <span className={`doc-status-badge ${w.active ? 'approved' : 'not-applicable'}`}>
                        {w.active ? 'פעיל' : 'מושבת'}
                      </span>
                    </td>
                    <td>
                      <div className="doc-actions">
                        <button type="button" className="doc-action-btn" disabled={busy === w.id} onClick={() => resetPassword(w)}>
                          איפוס סיסמה
                        </button>
                        <button
                          type="button"
                          className={`doc-action-btn ${w.active ? 'reject' : 'approve'}`}
                          disabled={busy === w.id}
                          onClick={() => toggleActive(w)}
                        >
                          {w.active ? 'השבת' : 'הפעל'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card nested-card">
          <h3 style={{ marginTop: 0 }}>הוספת עובד</h3>
          <form onSubmit={addWorker}>
            <div className="field">
              <label>שם מלא *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="field">
              <label>אימייל (לכניסה) *</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                dir="ltr"
                style={{ textAlign: 'right' }}
              />
            </div>
            <div className="field">
              <label>טלפון (לתזכורות וואטסאפ, פורמט בינלאומי: ...9725)</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                dir="ltr"
                style={{ textAlign: 'right' }}
                placeholder="972501234567"
              />
            </div>
            <div className="field">
              <label>סיסמה (8 תווים לפחות) *</label>
              <PasswordInput
                value={form.password}
                onChange={(v) => setForm({ ...form, password: v })}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            {error && <p className="form-error">{error}</p>}
            <button className="button" type="submit" disabled={saving}>
              {saving ? 'מוסיף…' : 'הוסף עובד'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
