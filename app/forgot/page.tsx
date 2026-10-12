'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PasswordInput } from '@/components/password-input';

type Channel = 'email' | 'whatsapp';

const CHANNELS: Array<{ id: Channel; label: string; icon: string }> = [
  { id: 'email', label: 'אימייל', icon: '📧' },
  { id: 'whatsapp', label: 'וואטסאפ', icon: '💬' },
];

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState('');
  const [channel, setChannel] = useState<Channel>('email');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, channel }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'שליחת הקוד נכשלה');
        return;
      }
      setStep(2);
    } catch {
      setError('שגיאת תקשורת');
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, newPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'האיפוס נכשל');
        return;
      }
      setStep(3);
      setTimeout(() => router.push('/login' as never), 2500);
    } catch {
      setError('שגיאת תקשורת');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="landing" dir="rtl">
      <div className="landing-hero" style={{ width: '100%', maxWidth: 420 }}>
        <div className="sidebar-brand" style={{ justifyContent: 'center', borderBottom: 'none' }}>
          <span className="sidebar-brand-mark">C</span>
          <div style={{ textAlign: 'start' }}>
            <div className="sidebar-brand-name">CRM_YE</div>
            <div className="sidebar-brand-sub">איפוס סיסמה</div>
          </div>
        </div>

        <div className="card staff-login-card" style={{ marginTop: 20 }}>
          {step === 1 && (
            <>
              <h2 style={{ marginTop: 0 }}>שכחת סיסמה?</h2>
              <p className="muted" style={{ marginTop: -6, fontSize: 14 }}>
                נשלח לך קוד אימות בן 6 ספרות בערוץ שתבחר (תקף ל-15 דקות).
              </p>
              <form onSubmit={requestCode}>
                <div className="field">
                  <label htmlFor="forgot-email">האימייל שאיתו אתה מתחבר</label>
                  <input
                    id="forgot-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    dir="ltr"
                    style={{ textAlign: 'right' }}
                  />
                </div>
                <div className="field">
                  <label>איך לשלוח את הקוד?</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {CHANNELS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={`choice-card ${channel === c.id ? 'selected' : ''}`}
                        style={{ flex: 1, justifyContent: 'center', padding: '10px 8px' }}
                        onClick={() => setChannel(c.id)}
                      >
                        {c.icon} {c.label}
                      </button>
                    ))}
                  </div>
                  {channel === 'whatsapp' && (
                    <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                      נשלח למספר הטלפון השמור בחשבון שלך.
                    </p>
                  )}
                </div>
                {error && <p className="form-error">{error}</p>}
                <button className="button" type="submit" disabled={loading} style={{ width: '100%' }}>
                  {loading ? 'שולח…' : 'שלח קוד אימות'}
                </button>
              </form>
            </>
          )}

          {step === 2 && (
            <>
              <h2 style={{ marginTop: 0 }}>הזן את הקוד</h2>
              <p className="muted" style={{ marginTop: -6, fontSize: 14 }}>
                אם הכתובת קיימת במערכת — קוד נשלח אליך ({CHANNELS.find((c) => c.id === channel)?.label}).
              </p>
              <form onSubmit={resetPassword}>
                <div className="field">
                  <label htmlFor="reset-code">קוד אימות (6 ספרות)</label>
                  <input
                    id="reset-code"
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    required
                    autoFocus
                    dir="ltr"
                    style={{ textAlign: 'center', letterSpacing: '0.4em', fontSize: 20, fontWeight: 700 }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="reset-password">סיסמה חדשה (8 תווים לפחות)</label>
                  <PasswordInput id="reset-password" value={newPassword} onChange={setNewPassword} required minLength={8} autoComplete="new-password" />
                </div>
                {error && <p className="form-error">{error}</p>}
                <button className="button" type="submit" disabled={loading} style={{ width: '100%' }}>
                  {loading ? 'מאפס…' : 'אפס סיסמה'}
                </button>
                <p style={{ textAlign: 'center', margin: '12px 0 0' }}>
                  <button type="button" className="mini-link" style={{ border: 'none', background: 'none', fontSize: 13 }} onClick={() => setStep(1)}>
                    לא קיבלתי קוד — שלח שוב
                  </button>
                </p>
              </form>
            </>
          )}

          {step === 3 && (
            <div style={{ textAlign: 'center' }}>
              <div className="success-mark">✓</div>
              <h2 style={{ margin: '0 0 6px' }}>הסיסמה אופסה בהצלחה</h2>
              <p className="muted" style={{ fontSize: 14 }}>מעביר אותך לדף הכניסה…</p>
            </div>
          )}
        </div>

        <p style={{ marginTop: 16 }}>
          <Link className="mini-link" href={'/login' as never} style={{ fontSize: 13 }}>← חזרה לכניסה</Link>
        </p>
      </div>
    </div>
  );
}
