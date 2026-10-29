'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '@/components/session-provider';
import {
  LoginList,
  ROLE_LABELS,
  SessionList,
  TempPassword,
  type LoginItem,
  type Role,
  type SessionItem,
} from '@/components/security-lists';
import { Empty, Field, PageHead, PasswordInput, Segmented, initials, timeAgo } from '@/components/ui/bits';
import { IconPlus, IconUsersCog } from '@/components/ui/icons';
import { Drawer, Modal } from '@/components/ui/overlay';
import { useToast } from '@/components/ui/toast';
import '@/app/styles/admin.css';

type TeamUser = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt?: string;
  createdAt: string;
  openCases: number;
  signedInDevices: number;
};

type Detail = {
  user: Omit<TeamUser, 'openCases' | 'signedInDevices'>;
  sessions: SessionItem[];
  logins: LoginItem[];
  canManage: boolean;
};

const ROLE_ORDER: Record<Role, number> = { owner: 0, admin: 1, worker: 2 };

async function api<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T & { ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, init?.body ? { ...init, headers: { 'Content-Type': 'application/json' } } : init);
    const json = await res.json();
    return res.ok ? json : { ...json, ok: false };
  } catch {
    return { ok: false, error: 'אין חיבור לשרת — נסו שוב' } as T & { ok: boolean; error?: string };
  }
}

export default function TeamPage() {
  const { me } = useSession();
  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [logins, setLogins] = useState<LoginItem[]>([]);
  const [show, setShow] = useState<'active' | 'inactive'>('active');
  const [openId, setOpenId] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [moreLogins, setMoreLogins] = useState(false);

  const load = useCallback(async () => {
    const [u, l] = await Promise.all([api<{ data: TeamUser[] }>('/api/users'), api<{ data: LoginItem[] }>('/api/users/logins')]);
    if (u.ok) setUsers(u.data);
    if (l.ok) setLogins(l.data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sorted = useMemo(
    () => (users ?? []).slice().sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name, 'he')),
    [users],
  );
  const active = sorted.filter((u) => u.active);
  const inactive = sorted.filter((u) => !u.active);
  const shown = show === 'active' || !inactive.length ? active : inactive;
  const failed = logins.filter((l) => !l.success).length;

  return (
    <div className="page">
      <PageHead
        eyebrow="ניהול"
        title="צוות והרשאות"
        sub="מי נכנס למערכת, באיזה תפקיד, ומאילו מכשירים."
        actions={
          <button type="button" className="button" onClick={() => setAdding(true)}>
            <IconPlus size={17} />
            משתמש חדש
          </button>
        }
      />

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">אנשי הצוות</div>
            <div className="card-sub">
              בעלים מנהל את כולם · מנהל מנהל עובדים · עובד רואה רק את התיקים שלו
            </div>
          </div>
          {inactive.length > 0 && (
            <Segmented
              label="סינון"
              value={show}
              onChange={setShow}
              options={[
                { value: 'active', label: `פעילים · ${active.length}` },
                { value: 'inactive', label: `מושבתים · ${inactive.length}` },
              ]}
            />
          )}
        </div>

        {!users ? (
          <div className="stack" style={{ gap: 8 }}>
            {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 48 }} />)}
          </div>
        ) : !shown.length ? (
          <Empty icon={<IconUsersCog size={30} />} title="אין עדיין אנשי צוות" action={<button className="button" onClick={() => setAdding(true)}>הוספת משתמש</button>}>
            הוסיפו עובד או מנהל — הם יקבלו סיסמה זמנית לכניסה הראשונה.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>שם</th>
                  <th>תפקיד</th>
                  <th className="team-hide-sm">תיקים פתוחים</th>
                  <th className="team-hide-sm">מכשירים</th>
                  <th>כניסה אחרונה</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => (
                  <tr
                    key={u.id}
                    className={`clickable team-row ${u.role === 'owner' ? 'owner' : ''} ${u.active ? '' : 'inactive'}`}
                    onClick={() => setOpenId(u.id)}
                    tabIndex={0}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpenId(u.id))}
                  >
                    <td>
                      <div className="team-person">
                        <span className={`avatar ${u.active ? '' : 'off'}`}>{initials(u.name)}</span>
                        <div style={{ minWidth: 0 }}>
                          <div className="list-title truncate">
                            {u.name}
                            {u.id === me?.id && <span className="muted small"> (אתם)</span>}
                          </div>
                          <div className="list-sub truncate ltr" style={{ textAlign: 'right' }}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <span className={`chip ${u.role === 'worker' ? '' : 'accent'}`}>{ROLE_LABELS[u.role]}</span>
                        {!u.active && <span className="chip">מושבת</span>}
                        {u.active && u.mustChangePassword && <span className="chip amber">ממתין לסיסמה</span>}
                      </div>
                    </td>
                    <td className="team-hide-sm num">{u.openCases || <span className="muted">—</span>}</td>
                    <td className="team-hide-sm num">{u.signedInDevices || <span className="muted">—</span>}</td>
                    <td className="muted small nowrap">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'עוד לא נכנס'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">כניסות אחרונות</div>
            <div className="card-sub">
              {failed ? `${failed} ניסיונות שנכשלו ברשימה — שווה להציץ אם שם לא מוכר חוזר` : 'כל הכניסות לאחרונה הצליחו'}
            </div>
          </div>
        </div>
        <LoginList logins={moreLogins ? logins : logins.slice(0, 12)} showName />
        {logins.length > 12 && !moreLogins && (
          <button type="button" className="button button-quiet button-compact" style={{ marginTop: 8 }} onClick={() => setMoreLogins(true)}>
            עוד {logins.length - 12} כניסות
          </button>
        )}
      </div>

      {adding && <NewUserModal isOwner={me?.role === 'owner'} onClose={() => setAdding(false)} onCreated={load} />}
      {openId && <UserDrawer id={openId} myId={me?.id} isOwner={me?.role === 'owner'} onClose={() => setOpenId(undefined)} onChanged={load} />}
    </div>
  );
}

function NewUserModal({ isOwner, onClose, onCreated }: { isOwner: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'worker' | 'admin'>('worker');
  const [ownPassword, setOwnPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; temporaryPassword?: string }>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const res = await api<{ data: { name: string }; temporaryPassword?: string }>('/api/users', {
      method: 'POST',
      body: JSON.stringify({ name, email, phone, role, password: ownPassword ? password : undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error || 'ההוספה נכשלה');
      return;
    }
    setCreated({ name: res.data.name, temporaryPassword: res.temporaryPassword });
    onCreated();
  }

  if (created) {
    return (
      <Modal
        title={`${created.name} נוסף/ה לצוות`}
        onClose={onClose}
        size="narrow"
        footer={<button type="button" className="button" onClick={onClose}>סיום</button>}
      >
        {created.temporaryPassword ? (
          <TempPassword password={created.temporaryPassword} name={created.name} />
        ) : (
          <p style={{ margin: 0 }}>מסרו ל{created.name} את הסיסמה שקבעתם. בכניסה הראשונה המערכת תבקש להחליף אותה.</p>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          כתובת הכניסה: <span className="ltr">{typeof window !== 'undefined' ? window.location.origin : ''}/login</span>
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title="משתמש חדש"
      subtitle="יקבל גישה לפי התפקיד. אפשר לשנות הכול אחר כך."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={onClose}>ביטול</button>
          <button type="submit" form="new-user" className="button" disabled={busy}>
            {busy ? 'מוסיפים…' : 'הוספה לצוות'}
          </button>
        </>
      }
    >
      <form id="new-user" className="form-grid" onSubmit={submit}>
        <Field label="שם מלא" required>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </Field>
        <Field label="טלפון" hint="לקודי איפוס בוואטסאפ">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" style={{ textAlign: 'right' }} />
        </Field>
        <Field label="אימייל לכניסה" required full>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required dir="ltr" style={{ textAlign: 'right' }} />
        </Field>
        <div className="field full">
          <span className="field-label">תפקיד</span>
          {isOwner ? (
            <Segmented
              label="תפקיד"
              value={role}
              onChange={setRole}
              options={[
                { value: 'worker', label: 'עובד' },
                { value: 'admin', label: 'מנהל' },
              ]}
            />
          ) : (
            <span className="chip" style={{ justifySelf: 'start' }}>עובד</span>
          )}
          <span className="field-hint">
            {role === 'admin'
              ? 'מנהל רואה את כל התיקים, התשלומים וההגדרות, ומנהל עובדים.'
              : 'עובד רואה את התיקים שפתח או שהועברו אליו, ומשימות שלו.'}
            {!isOwner && ' רק בעל המערכת מוסיף מנהלים.'}
          </span>
        </div>
        <div className="field full">
          <label className="checkbox">
            <input type="checkbox" checked={ownPassword} onChange={(e) => setOwnPassword(e.target.checked)} />
            אקבע סיסמה ראשונה בעצמי
          </label>
          {ownPassword ? (
            <PasswordInput value={password} onChange={setPassword} required minLength={8} autoComplete="new-password" placeholder="8 תווים לפחות" />
          ) : (
            <span className="field-hint">המערכת תיצור סיסמה זמנית ותציג אותה פעם אחת.</span>
          )}
        </div>
        {error && <p className="form-error full">{error}</p>}
      </form>
    </Modal>
  );
}

type Confirm = 'deactivate' | 'reset' | 'sign-out' | 'delete' | null;

function UserDrawer({
  id,
  myId,
  isOwner,
  onClose,
  onChanged,
}: {
  id: string;
  myId?: string;
  isOwner: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Role>('worker');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [tempPassword, setTempPassword] = useState<string>();
  const [heirs, setHeirs] = useState<{ id: string; name: string }[]>([]);
  const [heirId, setHeirId] = useState('');

  // Who can take over a deleted account's cases: everyone active.
  useEffect(() => {
    if (confirm !== 'delete') return;
    api<{ data: { id: string; name: string; active: boolean; role: Role }[] }>('/api/users').then((res) => {
      if (!res.ok) return;
      const active = res.data.filter((u) => u.active && u.id !== id);
      setHeirs(active);
      setHeirId((prev) => prev || active.find((u) => u.role === 'owner')?.id || active[0]?.id || '');
    });
  }, [confirm, id]);

  async function removeForGood() {
    if (!user) return;
    setError('');
    setBusy(true);
    const res = await api<{ cases: number; tasks: number }>(`/api/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: JSON.stringify({ transferTo: heirId }),
    });
    setBusy(false);
    if (!res.ok) {
      setConfirm(null);
      setError(res.error || 'המחיקה נכשלה');
      return;
    }
    const moved = [res.cases ? `${res.cases} תיקים` : '', res.tasks ? `${res.tasks} משימות` : ''].filter(Boolean).join(' ו-');
    toast(`החשבון של ${user.name} נמחק${moved ? ` · ${moved} הועברו` : ''}`);
    onChanged();
    onClose();
  }

  const load = useCallback(async () => {
    const res = await api<{ data: Detail }>(`/api/users/${encodeURIComponent(id)}`);
    if (!res.ok) {
      setError(res.error || 'לא הצלחנו לטעון את המשתמש');
      return;
    }
    setDetail(res.data);
    setName(res.data.user.name);
    setEmail(res.data.user.email);
    setPhone(res.data.user.phone ?? '');
    setRole(res.data.user.role);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const user = detail?.user;
  const isSelf = id === myId;
  const editable = !!detail?.canManage;
  const actionable = editable && !isSelf;
  const dirty = !!user && (name !== user.name || email !== user.email || phone !== (user.phone ?? '') || role !== user.role);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError('');
    setBusy(true);
    const res = await api(`/api/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, email, phone, role: role !== user.role ? role : undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error || 'השמירה נכשלה');
      return;
    }
    toast(role !== user.role ? `נשמר · ${name} מעכשיו ${ROLE_LABELS[role]}` : 'הפרטים נשמרו');
    load();
    onChanged();
  }

  async function run(kind: Exclude<Confirm, null> | 'reactivate') {
    if (!user || kind === 'delete') return;
    setError('');
    setBusy(true);
    const res =
      kind === 'deactivate' || kind === 'reactivate'
        ? await api(`/api/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ active: kind === 'reactivate' }) })
        : await api<{ temporaryPassword?: string; ended?: number }>(`/api/users/${encodeURIComponent(id)}`, {
            method: 'POST',
            body: JSON.stringify({ action: kind === 'reset' ? 'reset-password' : 'sign-out' }),
          });
    setBusy(false);
    setConfirm(null);
    if (!res.ok) {
      setError(res.error || 'הפעולה נכשלה');
      return;
    }
    if (kind === 'reset') setTempPassword((res as { temporaryPassword?: string }).temporaryPassword);
    toast(
      kind === 'deactivate'
        ? `${user.name} הושבת ונותק מכל המכשירים`
        : kind === 'reactivate'
          ? `${user.name} פעיל שוב`
          : kind === 'reset'
            ? 'הונפקה סיסמה זמנית'
            : `${user.name} נותק מכל המכשירים`,
    );
    load();
    onChanged();
  }

  return (
    <Drawer
      title={
        user ? (
          <div className="row" style={{ gap: 10 }}>
            <span className={`avatar ${user.active ? '' : 'off'}`}>{initials(user.name)}</span>
            <span>{user.name}</span>
            <span className={`chip ${user.role === 'worker' ? '' : 'accent'}`}>{ROLE_LABELS[user.role]}</span>
            {!user.active && <span className="chip">מושבת</span>}
          </div>
        ) : (
          'טוען…'
        )
      }
      onClose={onClose}
    >
      {!detail ? (
        error ? <p className="form-error">{error}</p> : <div className="skeleton" style={{ height: 220 }} />
      ) : (
        <>
          {tempPassword && user && <TempPassword password={tempPassword} name={user.name} />}

          {isSelf ? (
            <div className="notice">
              זה החשבון שלכם. פרטים, סיסמה ומכשירים מנוהלים ב
              <Link href="/account" className="text-link">החשבון שלי</Link>.
            </div>
          ) : !editable ? (
            <div className="notice">
              {user?.role === 'owner' ? 'את חשבון הבעלים מנהל רק הבעלים עצמו.' : 'מנהלים אחרים מנוהלים על ידי בעל המערכת. אפשר לצפות בלבד.'}
            </div>
          ) : null}

          <form className="drawer-section" onSubmit={save}>
            <div className="drawer-section-title">פרטים</div>
            <div className="form-grid">
              <Field label="שם מלא" full>
                <input value={name} onChange={(e) => setName(e.target.value)} disabled={!actionable} required />
              </Field>
              <Field label="אימייל לכניסה" full>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!actionable} required dir="ltr" style={{ textAlign: 'right' }} />
              </Field>
              <Field label="טלפון" full>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!actionable} dir="ltr" style={{ textAlign: 'right' }} />
              </Field>
              {user?.role !== 'owner' && (
                <div className="field full">
                  <span className="field-label">תפקיד</span>
                  {actionable && isOwner ? (
                    <Segmented
                      label="תפקיד"
                      value={role}
                      onChange={setRole}
                      options={[
                        { value: 'worker', label: 'עובד' },
                        { value: 'admin', label: 'מנהל' },
                      ]}
                    />
                  ) : (
                    <span className="chip" style={{ justifySelf: 'start' }}>{ROLE_LABELS[role]}</span>
                  )}
                  {actionable && role !== user?.role && (
                    <span className="field-hint">שינוי תפקיד מנתק את {user?.name} מכל המכשירים — הכניסה הבאה תהיה עם ההרשאות החדשות.</span>
                  )}
                </div>
              )}
            </div>
            {error && <p className="form-error">{error}</p>}
            {actionable && (
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button type="submit" className="button" disabled={!dirty || busy}>שמירה</button>
              </div>
            )}
          </form>

          {actionable && user && (
            <div className="drawer-section">
              <div className="drawer-section-title">גישה</div>
              {confirm === 'delete' ? (
                <div className="notice warn" style={{ display: 'grid', gap: 10 }}>
                  <span>
                    למחוק את החשבון של {user.name} לצמיתות? האימייל <span className="ltr">{user.email}</span> ישתחרר לשימוש. ההיסטוריה נשמרת.
                  </span>
                  <label className="field">
                    <span className="field-label">מי מקבל את התיקים והמשימות הפתוחות שלו</span>
                    <select value={heirId} onChange={(e) => setHeirId(e.target.value)}>
                      {heirs.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="row">
                    <button type="button" className="button button-danger button-compact" disabled={busy || !heirId} onClick={() => void removeForGood()}>
                      מחיקה לצמיתות
                    </button>
                    <button type="button" className="button button-quiet button-compact" onClick={() => setConfirm(null)}>ביטול</button>
                  </div>
                </div>
              ) : confirm ? (
                <div className="notice warn" style={{ display: 'grid', gap: 10 }}>
                  <span>
                    {confirm === 'deactivate' && `להשבית את ${user.name}? הכניסה תיחסם והמכשירים ינותקו. התיקים נשארים במקומם.`}
                    {confirm === 'reset' && `להנפיק סיסמה זמנית ל${user.name}? הסיסמה הנוכחית תפסיק לעבוד והמכשירים ינותקו.`}
                    {confirm === 'sign-out' && `לנתק את ${user.name} מכל המכשירים? אפשר יהיה להיכנס שוב עם הסיסמה.`}
                  </span>
                  <div className="row">
                    <button type="button" className={`button button-compact ${confirm === 'deactivate' ? 'button-danger' : ''}`} disabled={busy} onClick={() => run(confirm)}>
                      {confirm === 'deactivate' ? 'השבתה' : confirm === 'reset' ? 'הנפקת סיסמה' : 'ניתוק'}
                    </button>
                    <button type="button" className="button button-quiet button-compact" onClick={() => setConfirm(null)}>ביטול</button>
                  </div>
                </div>
              ) : (
                <div className="row">
                  {user.active && (
                    <button type="button" className="button button-secondary button-compact" onClick={() => setConfirm('reset')}>
                      סיסמה זמנית
                    </button>
                  )}
                  {user.active && detail.sessions.length > 0 && (
                    <button type="button" className="button button-secondary button-compact" onClick={() => setConfirm('sign-out')}>
                      ניתוק מכל המכשירים
                    </button>
                  )}
                  <span className="spacer" />
                  {user.active ? (
                    <button type="button" className="button button-danger button-compact" onClick={() => setConfirm('deactivate')}>
                      השבתה
                    </button>
                  ) : (
                    <>
                      {user.role !== 'owner' && (
                        <button type="button" className="button button-quiet button-compact" onClick={() => setConfirm('delete')}>
                          מחיקה לצמיתות
                        </button>
                      )}
                      <button type="button" className="button button-compact" disabled={busy} onClick={() => run('reactivate')}>
                        החזרה לפעילות
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="drawer-section">
            <div className="drawer-section-title">מחובר כרגע · {detail.sessions.length}</div>
            <SessionList sessions={detail.sessions} empty="לא מחובר מאף מכשיר" />
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title">כניסות אחרונות</div>
            <LoginList logins={detail.logins} empty="עוד לא נכנס למערכת" />
          </div>
        </>
      )}
    </Drawer>
  );
}
