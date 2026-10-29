'use client';

// Send a test message and watch recent deliveries.
import { useCallback, useEffect, useState } from 'react';
import { Empty, Field, timeAgo } from '@/components/ui/bits';
import { IconMail, IconSend, IconWhatsapp } from '@/components/ui/icons';
import { useToast } from '@/components/ui/toast';

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

const STATUS: Record<string, { label: string; tone: string }> = {
  queued: { label: 'בתור', tone: '' },
  sent: { label: 'נשלח', tone: 'accent' },
  delivered: { label: 'נמסר', tone: 'green' },
  read: { label: 'נקרא', tone: 'green' },
  failed: { label: 'נכשל', tone: 'red' },
};

const PROVIDER_LABELS: Record<string, string> = { gmail: 'Gmail', resend: 'Resend', whatsapp: 'Meta' };

export function ConnectionTools({ emailReady, whatsappReady }: { emailReady: boolean; whatsappReady: boolean }) {
  const toast = useToast();
  const [log, setLog] = useState<LogRow[] | null>(null);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState<'' | 'email' | 'whatsapp'>('');
  const [error, setError] = useState('');

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
    setError('');
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, to: channel === 'email' ? email : phone }),
      });
      const data = await res.json();
      if (data.ok) toast(channel === 'email' ? 'הודעת בדיקה נשלחה. בדקו את תיבת הדואר.' : 'הודעת בדיקה נשלחה. בדקו את הוואטסאפ.');
      else setError(data.error || 'השליחה נכשלה');
    } catch {
      setError('אין חיבור לשרת');
    } finally {
      setBusy('');
      void loadLog();
    }
  }

  return (
    <>
      <section className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">שליחת בדיקה</h2>
            <div className="card-sub">שולחים הודעה אחת לכתובת או למספר שלכם, כדי לוודא שהחיבור עובד מקצה לקצה.</div>
          </div>
        </div>
        <div className="grid-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendTest('email');
            }}
          >
            <Field label="מייל לבדיקה" hint={emailReady ? undefined : 'שליחת מייל עוד לא הוגדרה בשרת.'}>
              <div className="test-form">
                <input className="input" type="email" dir="ltr" style={{ textAlign: 'right' }} value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="name@example.com" />
                <button type="submit" className="button" disabled={!emailReady || Boolean(busy)}>
                  <IconMail size={16} /> {busy === 'email' ? 'שולח…' : 'שליחה'}
                </button>
              </div>
            </Field>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendTest('whatsapp');
            }}
          >
            <Field label="וואטסאפ לבדיקה" hint={whatsappReady ? 'שלחו רק למספר שלכם.' : 'וואטסאפ עוד לא הוגדר בשרת.'}>
              <div className="test-form">
                <input className="input" type="tel" dir="ltr" style={{ textAlign: 'right' }} value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="050-0000000" />
                <button type="submit" className="button" disabled={!whatsappReady || Boolean(busy)}>
                  <IconWhatsapp size={16} /> {busy === 'whatsapp' ? 'שולח…' : 'שליחה'}
                </button>
              </div>
            </Field>
          </form>
        </div>
        {error && (
          <p className="form-error" role="alert" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">הודעות שיצאו לאחרונה</h2>
            <div className="card-sub">50 האחרונות: מיילים והודעות וואטסאפ שהמערכת שלחה, ומה קרה איתן.</div>
          </div>
          <button type="button" className="button button-secondary button-compact" onClick={() => void loadLog()}>
            רענון
          </button>
        </div>
        {log === null ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : log.length === 0 ? (
          <Empty icon={<IconSend size={30} />} title="עוד לא יצאו הודעות">
            כאן יופיעו תזכורות, קישורים למסמכים והודעות בדיקה.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>מתי</th>
                  <th>מה</th>
                  <th>דרך</th>
                  <th>אל</th>
                  <th>מצב</th>
                </tr>
              </thead>
              <tbody>
                {log.map((row) => {
                  const status = STATUS[row.status] ?? { label: row.status, tone: 'amber' };
                  return (
                    <tr key={row.id}>
                      <td className="small nowrap" title={new Date(row.created_at).toLocaleString('he-IL')}>
                        {timeAgo(row.created_at)}
                      </td>
                      <td className="small">{KIND_LABELS[row.kind] ?? row.kind}</td>
                      <td className="small nowrap">
                        {row.channel === 'email' ? 'מייל' : 'וואטסאפ'}
                        {PROVIDER_LABELS[row.provider] && <span className="muted"> · {PROVIDER_LABELS[row.provider]}</span>}
                      </td>
                      <td className="mono small">{row.recipient}</td>
                      <td>
                        <span className={`chip ${status.tone}`}>{status.label}</span>
                        {row.error && (
                          <div className="tiny muted ltr" style={{ marginTop: 4, maxWidth: 340, overflowWrap: 'anywhere' }}>
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
      </section>
    </>
  );
}
