'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AuthSide, useBranding } from '@/components/auth-side';
import { Field, PasswordInput, Segmented } from '@/components/ui/bits';
import { IconArrowRight, IconCheck, IconMail, IconWhatsapp } from '@/components/ui/icons';
import '@/app/styles/admin.css';

type Channel = 'email' | 'whatsapp';

export default function ForgotPasswordPage() {
  const brand = useBranding();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState('');
  const [channel, setChannel] = useState<Channel>('email');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function post(url: string, body: object) {
    setError('');
    setBusy(true);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'הפעולה נכשלה');
        return false;
      }
      return true;
    } catch {
      setError('אין חיבור לשרת — נסו שוב');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    if (await post('/api/auth/forgot', { email, channel })) {
      setCode('');
      setStep(2);
    }
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    if (await post('/api/auth/reset', { email, code, newPassword })) setStep(3);
  }

  return (
    <div className="auth">
      <AuthSide {...brand} />
      <main className="auth-main">
        {step === 1 && (
          <form className="auth-card" onSubmit={requestCode}>
            <div>
              <div className="page-eyebrow">{brand.businessName}</div>
              <h1 className="page-title">איפוס סיסמה</h1>
              <p className="page-sub" style={{ marginBottom: 0 }}>נשלח קוד בן 6 ספרות. הוא תקף ל-15 דקות.</p>
            </div>
            <Field label="האימייל שאיתו נכנסים">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus dir="ltr" style={{ textAlign: 'right' }} />
            </Field>
            <div className="field">
              <span className="field-label">לאן לשלוח את הקוד</span>
              <Segmented
                label="ערוץ שליחה"
                value={channel}
                onChange={setChannel}
                options={[
                  { value: 'email', label: <><IconMail size={15} /> אימייל</> },
                  { value: 'whatsapp', label: <><IconWhatsapp size={15} /> וואטסאפ</> },
                ]}
              />
              {channel === 'whatsapp' && <span className="field-hint">למספר הטלפון ששמור בחשבון.</span>}
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="submit" className="button" disabled={busy} style={{ height: 44 }}>
              {busy ? 'שולחים…' : 'שליחת קוד'}
            </button>
            <BackToLogin />
          </form>
        )}

        {step === 2 && (
          <form className="auth-card" onSubmit={reset}>
            <div>
              <div className="page-eyebrow">{brand.businessName}</div>
              <h1 className="page-title">הקוד שקיבלתם</h1>
              <p className="page-sub" style={{ marginBottom: 0 }}>
                אם <span className="ltr">{email}</span> רשום במערכת, הקוד נשלח {channel === 'email' ? 'באימייל' : 'בוואטסאפ'}.
              </p>
            </div>
            <Field label="קוד אימות">
              <input
                className="code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                required
                autoFocus
                dir="ltr"
              />
            </Field>
            <Field label="סיסמה חדשה" hint="8 תווים לפחות">
              <PasswordInput value={newPassword} onChange={setNewPassword} required minLength={8} autoComplete="new-password" />
            </Field>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="submit" className="button" disabled={busy || code.length !== 6} style={{ height: 44 }}>
              {busy ? 'שומרים…' : 'שמירת הסיסמה החדשה'}
            </button>
            <button type="button" className="text-link small" style={{ justifySelf: 'center', background: 'none', border: 0 }} onClick={() => { setError(''); setStep(1); }}>
              לא הגיע קוד? שליחה מחדש
            </button>
          </form>
        )}

        {step === 3 && (
          <div className="auth-card" style={{ justifyItems: 'start' }}>
            <span className="done-mark"><IconCheck size={24} /></span>
            <div>
              <h1 className="page-title">הסיסמה עודכנה</h1>
              <p className="page-sub">מעכשיו נכנסים עם הסיסמה החדשה. מכשירים אחרים שהיו מחוברים נותקו.</p>
            </div>
            <Link href="/login" className="button" style={{ height: 44, width: '100%' }}>
              לכניסה
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}

function BackToLogin() {
  return (
    <Link href="/login" className="text-link small row" style={{ justifySelf: 'center', gap: 4 }}>
      <IconArrowRight size={14} />
      חזרה לכניסה
    </Link>
  );
}
