'use client';

// Shared by /account and /admin/users: signed-in devices, sign-in history,
// and the one-time display of a temporary password.
import { useState } from 'react';
import { formatDate, timeAgo } from '@/components/ui/bits';
import { IconCheck, IconX } from '@/components/ui/icons';

export type Role = 'owner' | 'admin' | 'worker';

export const ROLE_LABELS: Record<Role, string> = { owner: 'בעלים', admin: 'מנהל', worker: 'עובד' };

export type SessionItem = { id: string; createdAt: string; lastSeenAt: string; ip?: string; userAgent?: string; current?: boolean };
export type LoginItem = { id: number; userId?: string; name?: string; email: string; success: boolean; reason?: string; ip?: string; userAgent?: string; at: string };

const REASONS: Record<string, string> = {
  'wrong-password': 'סיסמה שגויה',
  'unknown-email': 'אימייל לא מוכר',
  inactive: 'חשבון מושבת',
  locked: 'נחסם זמנית אחרי ניסיונות רבים',
};

/** "Chrome · Windows" from a user-agent string. */
export function deviceLabel(ua?: string) {
  if (!ua) return 'מכשיר לא מזוהה';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'דפדפן';
  const os = /iPhone|iPad/.test(ua)
    ? 'iPhone'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} · ${os}` : browser;
}

const isPhone = (ua?: string) => !!ua && /iPhone|Android|Mobile/.test(ua);

export const IconMonitor = ({ size = 17 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);

export const IconSmartphone = ({ size = 17 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="2" width="14" height="20" rx="2" />
    <path d="M12 18h.01" />
  </svg>
);

export const IconCopy = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export function SessionList({
  sessions,
  onSignOut,
  busyId,
  empty = 'אין מכשירים מחוברים',
}: {
  sessions: SessionItem[];
  onSignOut?: (id: string) => void;
  busyId?: string;
  empty?: string;
}) {
  if (!sessions.length) return <p className="muted small" style={{ margin: 0 }}>{empty}</p>;
  return (
    <div>
      {sessions.map((s) => (
        <div key={s.id} className="sec-row">
          <span className="sec-icon">{isPhone(s.userAgent) ? <IconSmartphone /> : <IconMonitor />}</span>
          <div className="sec-main">
            <span className="sec-title">
              {deviceLabel(s.userAgent)}
              {s.current && (
                <span className="chip green" style={{ marginInlineStart: 8 }}>
                  המכשיר הזה
                </span>
              )}
            </span>
            <span className="sec-sub">
              פעיל {timeAgo(s.lastSeenAt)} · נכנס {formatDate(s.createdAt)}
              {s.ip && <span className="ltr"> · {s.ip}</span>}
            </span>
          </div>
          {onSignOut && !s.current && (
            <button type="button" className="button button-quiet button-compact" disabled={busyId === s.id} onClick={() => onSignOut(s.id)}>
              ניתוק
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function LoginList({ logins, showName, empty = 'עדיין אין כניסות' }: { logins: LoginItem[]; showName?: boolean; empty?: string }) {
  if (!logins.length) return <p className="muted small" style={{ margin: 0 }}>{empty}</p>;
  return (
    <div>
      {logins.map((l) => (
        <div key={l.id} className="sec-row">
          <span className={`sec-icon ${l.success ? 'ok' : 'bad'}`}>{l.success ? <IconCheck size={16} /> : <IconX size={16} />}</span>
          <div className="sec-main">
            <span className="sec-title">
              {showName ? l.name || <span className="ltr">{l.email}</span> : l.success ? 'כניסה' : 'ניסיון כניסה שנכשל'}
              {showName && !l.success && <span className="chip red" style={{ marginInlineStart: 8 }}>נכשל</span>}
            </span>
            <span className="sec-sub">
              {!l.success && l.reason && `${REASONS[l.reason] ?? l.reason} · `}
              {deviceLabel(l.userAgent)}
              {l.ip && <span className="ltr"> · {l.ip}</span>}
            </span>
          </div>
          <span className="sec-sub nowrap" title={formatDate(l.at, true)}>{timeAgo(l.at)}</span>
        </div>
      ))}
    </div>
  );
}

/** A temporary password, shown once with a copy button. */
export function TempPassword({ password, name }: { password: string; name: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked: the password is on screen to copy by hand */
    }
  }
  return (
    <div className="temp-pass">
      <div className="small strong">הסיסמה הזמנית של {name}</div>
      <div className="temp-pass-value">
        <span>{password}</span>
        <button type="button" className="button button-secondary button-compact" onClick={copy}>
          {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
          {copied ? 'הועתקה' : 'העתקה'}
        </button>
      </div>
      <div className="small muted">
        היא מוצגת עכשיו בלבד. מסרו אותה ל{name} — בכניסה הראשונה המערכת תבקש לבחור סיסמה חדשה.
      </div>
    </div>
  );
}
