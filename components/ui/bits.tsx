'use client';

// Small shared pieces: page header, empty state, stamps, field wrapper,
// password input, segmented control.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChecklistStatus } from '@/lib/domain';
import { IconEye, IconEyeOff } from '@/components/ui/icons';

export function PageHead({
  eyebrow,
  title,
  sub,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <div className="empty-title">{title}</div>
      {children && <div className="small">{children}</div>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

const STAMP: Record<ChecklistStatus, { label: string; tone: string }> = {
  missing: { label: 'חסר', tone: 'missing' },
  received: { label: 'התקבל', tone: 'received' },
  'in-review': { label: 'בבדיקה', tone: 'review' },
  approved: { label: 'אושר', tone: 'approved' },
  'resubmit-needed': { label: 'נדרש מחדש', tone: 'resubmit' },
  'not-applicable': { label: 'לא רלוונטי', tone: 'na' },
};

/** Rubber-stamp status. Lands with a short "thunk" when the status changes. */
export function Stamp({ status, big }: { status: ChecklistStatus; big?: boolean }) {
  const first = useRef(true);
  const [thunk, setThunk] = useState(false);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setThunk(true);
    const t = setTimeout(() => setThunk(false), 400);
    return () => clearTimeout(t);
  }, [status]);
  const s = STAMP[status];
  return <span className={`stamp ${s.tone} ${big ? 'big' : ''} ${thunk ? 'thunk' : ''}`}>{s.label}</span>;
}

/** Free-text stamp (e.g. a decision: "אושר", "נדחה"). */
export function StampText({ tone, children, big }: { tone: 'approved' | 'missing' | 'review' | 'received' | 'na'; children: ReactNode; big?: boolean }) {
  return <span className={`stamp ${tone} ${big ? 'big' : ''}`}>{children}</span>;
}

export function Field({
  label,
  required,
  hint,
  children,
  full,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`field ${full ? 'full' : ''}`}>
      <span className="field-label">
        {label}
        {required && <span className="req" aria-hidden="true">*</span>}
      </span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function PasswordInput({
  value,
  onChange,
  id,
  autoComplete,
  required,
  minLength,
  autoFocus,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <span className="password-wrap">
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        autoFocus={autoFocus}
        placeholder={placeholder}
        dir="ltr"
        style={{ textAlign: 'right' }}
      />
      <button type="button" className="password-eye" onClick={() => setShown((v) => !v)} aria-label={shown ? 'הסתרת הסיסמה' : 'הצגת הסיסמה'}>
        {shown ? <IconEyeOff size={17} /> : <IconEye size={17} />}
      </button>
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function shekel(amount: number) {
  return `₪${amount.toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
}

export function formatDate(value?: string, withTime = false) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

/** "לפני 3 ימים" style relative time. */
export function timeAgo(value?: string) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'עכשיו';
  if (min < 60) return `לפני ${min} דק׳`;
  const h = Math.round(min / 60);
  if (h < 24) return `לפני ${h === 1 ? 'שעה' : `${h} שעות`}`;
  const d = Math.round(h / 24);
  if (d < 30) return `לפני ${d === 1 ? 'יום' : `${d} ימים`}`;
  return formatDate(value);
}

export function initials(name?: string) {
  if (!name) return '·';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
}
