'use client';

// "Remind me" from anywhere a gap shows up: a missing document, a case still
// missing documents, an unpaid fee, a client with missing details. The
// reminder can watch that gap and close itself once it is filled (see
// lib/task-watch.ts). Open reminders show next to what they are about.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '@/components/session-provider';
import { Field } from '@/components/ui/bits';
import { IconBell, IconCheck, IconClock } from '@/components/ui/icons';
import { Modal } from '@/components/ui/overlay';
import { useToast } from '@/components/ui/toast';
import { watchHint, type ClientDetailField, type ReminderChannel, type TaskWatchKind } from '@/lib/domain';

export type ReminderTarget = {
  /** Prefilled "what to check". */
  title: string;
  /** Shown under the dialog title, e.g. the client and case. */
  about?: string;
  clientId?: string;
  caseId?: string;
  /** Who handles the case — offered to admins as "the handler". */
  handlerId?: string;
  handlerName?: string;
  watch?: { kind: TaskWatchKind; code?: string; fields?: ClientDetailField[] };
};

export type OpenReminder = {
  id: string;
  title: string;
  dueAt?: string;
  remindAt?: string;
  assigneeId: string;
  assigneeName?: string;
  watchKind?: TaskWatchKind;
  watchRef?: string;
  status: 'open' | 'done';
};

const CHANGED = 'crmye:reminders-changed';

/** Open reminders about one case or client; refreshes when any reminder changes. */
export function useReminders(scope: { caseId?: string; clientId?: string }) {
  const [reminders, setReminders] = useState<OpenReminder[]>([]);
  const query = scope.caseId ? `caseId=${encodeURIComponent(scope.caseId)}` : scope.clientId ? `clientId=${encodeURIComponent(scope.clientId)}` : '';
  const load = useCallback(async () => {
    if (!query) return;
    const d = await fetch(`/api/tasks?open=1&${query}`)
      .then((r) => r.json())
      .catch(() => null);
    if (d?.ok) setReminders(d.data);
  }, [query]);
  useEffect(() => {
    void load();
    window.addEventListener(CHANGED, load);
    return () => window.removeEventListener(CHANGED, load);
  }, [load]);
  return { reminders, reload: load };
}

export function announceRemindersChanged() {
  window.dispatchEvent(new Event(CHANGED));
}

/** "היום 16:30", "מחר 09:00", "יום ג׳ 4 בנוב׳ 09:00". */
export function whenLabel(value?: string) {
  if (!value) return '';
  const d = new Date(value);
  const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return `היום ${time}`;
  if (diff === 1) return `מחר ${time}`;
  if (diff === -1) return `אתמול ${time}`;
  return `${d.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

type When = 'hour' | 'tomorrow' | 'days3' | 'week' | 'custom';

const WHEN_OPTIONS: { id: When; label: string }[] = [
  { id: 'hour', label: 'בעוד שעה' },
  { id: 'tomorrow', label: 'מחר ב-9:00' },
  { id: 'days3', label: 'בעוד 3 ימים' },
  { id: 'week', label: 'בעוד שבוע' },
  { id: 'custom', label: 'מועד אחר' },
];

function morningIn(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return d;
}

function resolveWhen(when: When, custom: string): Date | null {
  switch (when) {
    case 'hour':
      return new Date(Date.now() + 3_600_000);
    case 'tomorrow':
      return morningIn(1);
    case 'days3':
      return morningIn(3);
    case 'week':
      return morningIn(7);
    case 'custom': {
      const d = custom ? new Date(custom) : null;
      return d && !Number.isNaN(d.getTime()) ? d : null;
    }
  }
}

export function ReminderDialog({ target, onClose, onCreated }: { target: ReminderTarget; onClose: () => void; onCreated?: () => void }) {
  const { me } = useSession();
  const toast = useToast();
  const [title, setTitle] = useState(target.title);
  const [when, setWhen] = useState<When>('tomorrow');
  const [custom, setCustom] = useState('');
  const [assigneeId, setAssigneeId] = useState(me?.id ?? '');
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [channels, setChannels] = useState<ReminderChannel[]>([]);
  const [autoClose, setAutoClose] = useState(Boolean(target.watch));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me?.isAdmin) return;
    fetch('/api/users')
      .then((r) => r.json())
      .then((d) => d.ok && setPeople((d.data as { id: string; name: string; active: boolean }[]).filter((u) => u.active)))
      .catch(() => null);
  }, [me?.isAdmin]);

  const at = resolveWhen(when, custom);
  const atText = useMemo(
    () => (at ? at.toLocaleString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : ''),
    [at],
  );

  async function save() {
    setError('');
    if (!title.trim()) return setError('כתבו מה צריך לבדוק');
    if (!at) return setError('בחרו מועד');
    if (at.getTime() < Date.now() - 60_000) return setError('המועד כבר עבר');
    setBusy(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          notes: notes.trim() || undefined,
          dueAt: at.toISOString(),
          remindAt: at.toISOString(),
          reminderChannels: channels,
          assigneeId: me?.isAdmin ? assigneeId : undefined,
          clientId: target.clientId,
          caseId: target.caseId,
          watch: autoClose ? target.watch : undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) return setError(d.error || 'לא הצלחנו לשמור את התזכורת');
      toast(`תזכורת נקבעה: ${whenLabel(at.toISOString())}`);
      announceRemindersChanged();
      onCreated?.();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const handlerOffered = me?.isAdmin && target.handlerId && target.handlerId !== me.id;

  return (
    <Modal
      title="תזכורת"
      subtitle={target.about}
      onClose={onClose}
      size="narrow"
      footer={
        <>
          <button type="button" className="button" onClick={() => void save()} disabled={busy}>
            {busy ? 'שומרים…' : 'קביעת תזכורת'}
          </button>
          <button type="button" className="button button-quiet" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <Field label="מה לבדוק">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>

        <div className="field">
          <span className="field-label">מתי</span>
          <div className="row" style={{ gap: 6 }} role="radiogroup" aria-label="מתי להזכיר">
            {WHEN_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={when === o.id}
                className={`filter-chip ${when === o.id ? 'on' : ''}`}
                onClick={() => setWhen(o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>
          {when === 'custom' && (
            <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="מועד התזכורת" style={{ marginTop: 8 }} />
          )}
          {atText && (
            <span className="field-hint">
              <IconClock size={13} /> {atText}
            </span>
          )}
        </div>

        {me?.isAdmin && (
          <Field label="למי">
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value={me.id}>לי</option>
              {handlerOffered && <option value={target.handlerId}>{`למטפל בתיק — ${target.handlerName || ''}`}</option>}
              {people
                .filter((p) => p.id !== me.id && p.id !== target.handlerId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Field>
        )}

        {target.watch && (
          <label className="checkbox">
            <input type="checkbox" checked={autoClose} onChange={(e) => setAutoClose(e.target.checked)} />
            {watchHint(target.watch.kind)}
          </label>
        )}

        <div className="field">
          <span className="field-label">איך</span>
          <div className="row" style={{ gap: 14 }}>
            <span className="small muted">התראה במערכת תמיד</span>
            {(
              [
                ['email', 'גם באימייל'],
                ['whatsapp', 'גם בוואטסאפ'],
              ] as [ReminderChannel, string][]
            ).map(([c, label]) => (
              <label key={c} className="checkbox">
                <input
                  type="checkbox"
                  checked={channels.includes(c)}
                  onChange={() => setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <Field label="הערה">
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="לא חובה" />
        </Field>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** The "remind me" button. `icon` is a small bell for tight rows. */
export function RemindButton({
  target,
  variant = 'secondary',
  label = 'תזכורת',
  onCreated,
}: {
  target: ReminderTarget;
  variant?: 'secondary' | 'quiet' | 'icon';
  label?: string;
  onCreated?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === 'icon' ? (
        <button type="button" className="icon-button small" onClick={() => setOpen(true)} aria-label={`${label}: ${target.title}`} title={label}>
          <IconBell size={15} />
        </button>
      ) : (
        <button type="button" className={`button button-compact ${variant === 'quiet' ? 'button-quiet' : 'button-secondary'}`} onClick={() => setOpen(true)}>
          <IconBell size={15} />
          {label}
        </button>
      )}
      {open && <ReminderDialog target={target} onClose={() => setOpen(false)} onCreated={onCreated} />}
    </>
  );
}

/** Small "reminder set" chip next to the thing it is about. */
export function ReminderChip({ reminder }: { reminder: OpenReminder }) {
  const overdue = reminder.dueAt && new Date(reminder.dueAt).getTime() < Date.now();
  return (
    <Link href={'/tasks' as never} className={`reminder-chip ${overdue ? 'due' : ''}`} title={`${reminder.title}${reminder.assigneeName ? ` · ${reminder.assigneeName}` : ''}`}>
      <IconClock size={12} />
      {whenLabel(reminder.dueAt || reminder.remindAt)}
    </Link>
  );
}

/** Card listing the open reminders about a case or client, with "done". */
export function RemindersCard({ reminders, onChanged }: { reminders: OpenReminder[]; onChanged?: () => void }) {
  const toast = useToast();
  if (!reminders.length) return null;
  async function done(id: string) {
    const res = await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    }).catch(() => null);
    if (!res?.ok) return toast('לא הצלחנו לעדכן', 'error');
    toast('סומן כבוצע');
    announceRemindersChanged();
    onChanged?.();
  }
  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title">תזכורות פתוחות</div>
      </div>
      <div className="reminder-list">
        {reminders.map((r) => {
          const overdue = r.dueAt && new Date(r.dueAt).getTime() < Date.now();
          return (
            <div key={r.id} className="reminder-item">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="reminder-title" title={r.title}>{r.title}</div>
                <div className={`tiny ${overdue ? 'reminder-overdue' : 'muted'}`}>
                  {whenLabel(r.dueAt || r.remindAt)}
                  {r.assigneeName ? ` · ${r.assigneeName}` : ''}
                  {r.watchKind ? ` · ${watchHint(r.watchKind)}` : ''}
                </div>
              </div>
              <button type="button" className="icon-button small" onClick={() => void done(r.id)} aria-label={`סימון כבוצע: ${r.title}`} title="בוצע">
                <IconCheck size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
