'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Field, PasswordInput } from '@/components/ui/bits';
import { AuthSide, useBranding } from '@/components/auth-side';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const brand = useBranding();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'הכניסה נכשלה');
        return;
      }
      const next = params.get('next');
      const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/today';
      router.replace((data.mustChangePassword ? '/account?mustChange=1' : safeNext) as never);
      router.refresh();
    } catch {
      setError('אין חיבור לשרת — נסו שוב');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <AuthSide {...brand} />
      <main className="auth-main">
        <form className="auth-card" onSubmit={submit}>
          <div>
            <div className="page-eyebrow">{brand.businessName}</div>
            <h1 className="page-title">כניסה למערכת</h1>
          </div>
          <Field label="אימייל">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus dir="ltr" style={{ textAlign: 'right' }} />
          </Field>
          <Field label="סיסמה">
            <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" required />
          </Field>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="button" disabled={busy} style={{ height: 44 }}>
            {busy ? 'נכנסים…' : 'כניסה'}
          </button>
          <Link href="/forgot" className="text-link small" style={{ justifySelf: 'center' }}>
            שכחתי סיסמה
          </Link>
        </form>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
