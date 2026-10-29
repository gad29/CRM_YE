'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSession } from '@/components/session-provider';
import { LoginList, ROLE_LABELS, SessionList, type LoginItem, type Role, type SessionItem } from '@/components/security-lists';
import { Field, PageHead, PasswordInput, initials } from '@/components/ui/bits';
import { IconKey, IconLock, IconShield } from '@/components/ui/icons';
import { useToast } from '@/components/ui/toast';
import '@/app/styles/admin.css';

type AccountUser = { id: string; name: string; email: string; phone?: string; role: Role; lastLoginAt?: string; createdAt: string };
type AccountData = { user: AccountUser; sessions: SessionItem[]; logins: LoginItem[] };

function AccountView() {
  const params = useSearchParams();
  const { reload: reloadSession } = useSession();
  const toast = useToast();
  const mustChange = params.get('mustChange') === '1';

  const [data, setData] = useState<AccountData | null>(null);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/account');
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error);
      setData(json.data);
    } catch {
      setLoadError('לא הצלחנו לטעון את פרטי החשבון. רעננו את הדף.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="page">
      <PageHead eyebrow="החשבון שלי" title={data?.user.name || 'החשבון שלי'} sub={data ? `${ROLE_LABELS[data.user.role]} · ${data.user.email}` : ' '} />

      {mustChange && (
        <div className="must-change" role="alert">
          <IconLock size={20} />
          <div>
            <strong>לפני שממשיכים: בחרו סיסמה משלכם</strong>
            <span className="small">נכנסתם עם סיסמה זמנית. אחרי שתשמרו סיסמה חדשה תעברו למסך הבית.</span>
          </div>
        </div>
      )}

      {loadError && <p className="form-error">{loadError}</p>}

      <div className="layout-aside">
        <div className="stack">
          <PasswordCard
            highlight={mustChange}
            onDone={() => {
              // A full load, so the shell re-reads the session without the
              // must-change flag instead of bouncing back here.
              if (mustChange) {
                window.location.assign('/today');
                return;
              }
              reloadSession();
              load();
            }}
          />
          {data && !mustChange && <ProfileCard user={data.user} onSaved={() => { load(); reloadSession(); }} />}
          {data && (
            <DevicesCard
              sessions={data.sessions}
              onChange={load}
              notify={toast}
            />
          )}
        </div>
        <aside className="stack">
          {data ? (
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">כניסות אחרונות</div>
                  <div className="card-sub">כניסה שלא זיהיתם? החליפו סיסמה.</div>
                </div>
              </div>
              <LoginList logins={data.logins} />
            </div>
          ) : (
            <div className="skeleton" style={{ height: 240 }} />
          )}
        </aside>
      </div>
    </div>
  );
}

function ProfileCard({ user, onSaved }: { user: AccountUser; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const emailChanged = email.trim().toLowerCase() !== user.email;
  const dirty = name !== user.name || phone !== (user.phone ?? '') || emailChanged;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, email, currentPassword: emailChanged ? currentPassword : undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || 'השמירה נכשלה');
        return;
      }
      setCurrentPassword('');
      toast('הפרטים נשמרו');
      onSaved();
    } catch {
      setError('אין חיבור לשרת — נסו שוב');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={save}>
      <div className="card-head">
        <div className="row" style={{ gap: 12 }}>
          <span className="avatar lg">{initials(user.name)}</span>
          <div>
            <div className="card-title">פרטים אישיים</div>
            <div className="card-sub">כך תופיעו לצוות, בתיקים ובהודעות.</div>
          </div>
        </div>
      </div>
      <div className="form-grid">
        <Field label="שם מלא" required>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </Field>
        <Field label="טלפון" hint="לקודי איפוס בוואטסאפ">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" style={{ textAlign: 'right' }} />
        </Field>
        <Field label="אימייל לכניסה" required full>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required dir="ltr" style={{ textAlign: 'right' }} />
        </Field>
        {emailChanged && (
          <Field label="הסיסמה הנוכחית" hint="נדרשת כדי לשנות את אימייל הכניסה" full>
            <PasswordInput value={currentPassword} onChange={setCurrentPassword} required autoComplete="current-password" />
          </Field>
        )}
      </div>
      {error && <p className="form-error" style={{ marginTop: 14 }}>{error}</p>}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="submit" className="button" disabled={!dirty || busy}>
          {busy ? 'שומרים…' : 'שמירת הפרטים'}
        </button>
      </div>
    </form>
  );
}

function PasswordCard({ highlight, onDone }: { highlight: boolean; onDone: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (next !== repeat) {
      setError('שתי הסיסמאות החדשות אינן זהות');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || 'החלפת הסיסמה נכשלה');
        return;
      }
      setCurrent('');
      setNext('');
      setRepeat('');
      toast(json.otherDevicesSignedOut ? `הסיסמה הוחלפה · ${json.otherDevicesSignedOut} מכשירים אחרים נותקו` : 'הסיסמה הוחלפה');
      onDone();
    } catch {
      setError('אין חיבור לשרת — נסו שוב');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={save} style={highlight ? { borderColor: 'var(--amber)', boxShadow: '0 0 0 3px var(--amber-soft)' } : undefined}>
      <div className="card-head">
        <div className="row" style={{ gap: 12 }}>
          <span className="sec-icon"><IconKey size={17} /></span>
          <div>
            <div className="card-title">{highlight ? 'סיסמה חדשה' : 'החלפת סיסמה'}</div>
            <div className="card-sub">שאר המכשירים שלכם ינותקו. המכשיר הזה נשאר מחובר.</div>
          </div>
        </div>
      </div>
      <div className="form-grid">
        <Field label={highlight ? 'הסיסמה הזמנית שקיבלתם' : 'הסיסמה הנוכחית'} required full>
          <PasswordInput value={current} onChange={setCurrent} required autoComplete="current-password" autoFocus={highlight} />
        </Field>
        <Field label="סיסמה חדשה" hint="8 תווים לפחות" required>
          <PasswordInput value={next} onChange={setNext} required minLength={8} autoComplete="new-password" />
        </Field>
        <Field label="שוב, לאימות" required>
          <PasswordInput value={repeat} onChange={setRepeat} required minLength={8} autoComplete="new-password" />
        </Field>
      </div>
      {error && <p className="form-error" style={{ marginTop: 14 }}>{error}</p>}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="submit" className="button" disabled={busy || !current || next.length < 8 || !repeat}>
          {busy ? 'שומרים…' : 'שמירת הסיסמה'}
        </button>
      </div>
    </form>
  );
}

function DevicesCard({ sessions, onChange, notify }: { sessions: SessionItem[]; onChange: () => void; notify: (t: string, k?: 'ok' | 'error') => void }) {
  const [busyId, setBusyId] = useState<string>();
  const others = sessions.filter((s) => !s.current).length;

  async function signOut(id?: string) {
    setBusyId(id ?? 'all');
    try {
      const res = await fetch(`/api/account/sessions${id ? `?id=${encodeURIComponent(id)}` : ''}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error();
      notify(id ? 'המכשיר נותק' : 'כל שאר המכשירים נותקו');
      onChange();
    } catch {
      notify('הניתוק נכשל', 'error');
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div className="row" style={{ gap: 12 }}>
          <span className="sec-icon"><IconShield size={17} /></span>
          <div>
            <div className="card-title">מכשירים מחוברים</div>
            <div className="card-sub">{sessions.length === 1 ? 'רק המכשיר הזה' : `${sessions.length} מכשירים`}</div>
          </div>
        </div>
        {others > 0 && (
          <button type="button" className="button button-secondary button-compact" disabled={!!busyId} onClick={() => signOut()}>
            ניתוק כל השאר
          </button>
        )}
      </div>
      <SessionList sessions={sessions} onSignOut={signOut} busyId={busyId} />
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense>
      <AccountView />
    </Suspense>
  );
}
