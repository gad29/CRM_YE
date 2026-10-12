'use client';

// Connections page: send a test message and watch recent deliveries.

import { useCallback, useEffect, useState } from 'react';

type LogRow = {
  id: number;
  channel: string;
  provider: string;
  kind: string;
  recipient: string;
  status: string;
  error: string | null;
  created_at: string;
};

const KIND_LABELS: Record<string, string> = {
  'password-reset': 'איפוס סיסמה',
  documents: 'מסמכים ללקוח',
  reminder: 'תזכורת',
  'task-assigned': 'משימה חדשה',
  chat: 'צ׳אט',
  test: 'בדיקה',
};

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  sent: { label: 'נשלח', tone: 'good' },
  delivered: { label: 'נמסר', tone: 'good' },
  read: { label: 'נקרא', tone: 'good' },
  failed: { label: 'נכשל', tone: 'danger' },
};

export function IntegrationTools({ emailReady, whatsappReady }: { emailReady: boolean; whatsappReady: boolean }) {
  const [log, setLog] = useState<LogRow[]>([]);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState<'' | 'email' | 'whatsapp'>('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const loadLog = useCallback(async () => {
    try {
      const data = await fetch('/api/integrations').then((r) => r.json());
      if (data.ok) setLog(data.log);
    } catch {
      /* offline — keep the last list */
    }
  }, []);

  useEffect(() => {
    void loadLog();
  }, [loadLog]);

  async function sendTest(channel: 'email' | 'whatsapp') {
    setBusy(channel);
    setResult(null);
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, to: channel === 'email' ? email : phone }),
      });
      const data = await res.json();
      setResult(data.ok ? { ok: true, text: 'נשלח ✓ — בדקו את תיבת הדואר / הוואטסאפ' } : { ok: false, text: data.error || 'השליחה נכשלה' });
    } catch {
      setResult({ ok: false, text: 'אין חיבור לשרת' });
    } finally {
      setBusy('');
      void loadLog();
    }
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>שליחת בדיקה</h3>
        <div className="connection-grid">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendTest('email');
            }}
          >
            <label htmlFor="test-email">אימייל לבדיקה</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input id="test-email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="name@example.com" />
              <button type="submit" className="button" disabled={!emailReady || Boolean(busy)}>
                {busy === 'email' ? 'שולח…' : 'שלח'}
              </button>
            </div>
            {!emailReady && <p className="muted" style={{ fontSize: 12 }}>Resend עדיין לא הוגדר בשרת.</p>}
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendTest('whatsapp');
            }}
          >
            <label htmlFor="test-phone">מספר וואטסאפ לבדיקה</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input id="test-phone" type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="050-1234567" />
              <button type="submit" className="button" disabled={!whatsappReady || Boolean(busy)}>
                {busy === 'whatsapp' ? 'שולח…' : 'שלח'}
              </button>
            </div>
            {!whatsappReady && <p className="muted" style={{ fontSize: 12 }}>WhatsApp עדיין לא הוגדר בשרת.</p>}
          </form>
        </div>
        {result && (
          <p className={result.ok ? 'form-success' : 'form-error'} style={{ marginBottom: 0 }}>
            {result.text}
          </p>
        )}
      </div>

      <div className="card">
        <div className="split" style={{ alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>הודעות אחרונות</h3>
          <button type="button" className="doc-action-btn" onClick={() => void loadLog()}>
            רענון
          </button>
        </div>
        {log.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>עדיין לא נשלחו הודעות.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>מתי</th>
                  <th>סוג</th>
                  <th>ערוץ</th>
                  <th>נמען</th>
                  <th>מצב</th>
                </tr>
              </thead>
              <tbody>
                {log.map((row) => {
                  const status = STATUS_LABELS[row.status] ?? { label: row.status, tone: 'warn' };
                  return (
                    <tr key={row.id}>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(row.created_at).toLocaleString('he-IL')}</td>
                      <td style={{ fontSize: 13 }}>{KIND_LABELS[row.kind] ?? row.kind}</td>
                      <td style={{ fontSize: 13 }}>{row.channel === 'email' ? 'אימייל' : 'וואטסאפ'}</td>
                      <td dir="ltr" style={{ fontSize: 12 }}>{row.recipient}</td>
                      <td>
                        <span className={`badge ${status.tone}`} title={row.error || undefined}>
                          {status.label}
                        </span>
                        {row.error && (
                          <div className="muted" style={{ fontSize: 11, marginTop: 4, maxWidth: 320 }} dir="ltr">
                            {row.error}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
