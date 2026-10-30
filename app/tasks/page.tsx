'use client';

import '@/app/styles/tools.css';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { REMINDER_CHANNEL_LABELS, TASK_PRIORITY_LABELS, watchHint, type ReminderChannel, type TaskPriority, type TaskWatchKind } from '@/lib/domain';
import { useConfig } from '@/components/config-provider';
import { ModuleOff } from '@/components/module-off';
import { useSession } from '@/components/session-provider';
import { Empty, Field, PageHead, Segmented } from '@/components/ui/bits';
import { Modal } from '@/components/ui/overlay';
import { useToast } from '@/components/ui/toast';
import { IconBell, IconCheck, IconClients, IconClock, IconFolder, IconPlus, IconTasks, IconTrash, IconUser } from '@/components/ui/icons';

type TaskRow = {
  id: string;
  title: string;
  notes?: string;
  dueAt?: string;
  remindAt?: string;
  reminderChannels: ReminderChannel[];
  reminderSentAt?: string;
  priority: TaskPriority;
  assigneeId: string;
  assigneeName: string;
  clientId?: string;
  clientName?: string;
  caseId?: string;
  caseTitle?: string;
  status: 'open' | 'done';
  createdAt: string;
  completedAt?: string;
  watchKind?: TaskWatchKind;
  resolvedReason?: string;
};

type Person = { id: string; name: string; role: string; active: boolean };
type ClientOption = { id: string; fullName: string };
type CaseOption = { id: string; clientId: string; title: string; stage: string };

type FormState = {
  title: string;
  notes: string;
  dueAt: string;
  remindAt: string;
  priority: TaskPriority;
  assigneeId: string;
  clientId: string;
  caseId: string;
  channels: ReminderChannel[];
};

const EMPTY_FORM: FormState = {
  title: '',
  notes: '',
  dueAt: '',
  remindAt: '',
  priority: 'normal',
  assigneeId: '',
  clientId: '',
  caseId: '',
  channels: [],
};

/** ISO → the value a datetime-local input expects, in local time. */
function toLocalInput(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function whenLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `היום ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `מחר ${time}`;
  return d.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

type GroupId = 'overdue' | 'today' | 'later' | 'undated' | 'done';
const GROUP_LABELS: Record<GroupId, string> = {
  overdue: 'באיחור',
  today: 'להיום',
  later: 'בהמשך',
  undated: 'בלי תאריך',
  done: 'הושלמו',
};

function groupOf(task: TaskRow): GroupId {
  if (task.status === 'done') return 'done';
  if (!task.dueAt) return 'undated';
  const due = new Date(task.dueAt);
  if (due.getTime() < Date.now()) return 'overdue';
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  return due <= endOfDay ? 'today' : 'later';
}

const PRIORITY_ORDER: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2 };

function TasksPageInner() {
  const { me } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const isAdmin = Boolean(me?.isAdmin);

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<TaskRow | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(() => {
    fetch('/api/tasks')
      .then((r) => r.json())
      .then((d) => d.ok && setTasks(d.data))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
    fetch('/api/clients')
      .then((r) => r.json())
      .then((d) => d.ok && setClients(d.data))
      .catch(() => null);
    fetch('/api/cases')
      .then((r) => r.json())
      .then((d) => d.ok && setCases(d.data))
      .catch(() => null);
  }, [reload]);

  useEffect(() => {
    if (!isAdmin) return;
    fetch('/api/users')
      .then((r) => r.json())
      .then((d) => d.ok && setPeople(d.data.filter((p: Person) => p.active)))
      .catch(() => null);
  }, [isAdmin]);

  // Other pages open the form prefilled: /tasks?new=1&clientId=…&caseId=…
  useEffect(() => {
    if (params.get('new') !== '1' || !me) return;
    setForm({ ...EMPTY_FORM, assigneeId: me.id, clientId: params.get('clientId') || '', caseId: params.get('caseId') || '' });
    setError('');
    setEditing('new');
    router.replace('/tasks' as never);
  }, [params, me, router]);

  const visible = useMemo(
    () => (isAdmin && scope === 'mine' && me ? tasks.filter((t) => t.assigneeId === me.id) : tasks),
    [tasks, scope, isAdmin, me],
  );

  const groups = useMemo(() => {
    const map: Record<GroupId, TaskRow[]> = { overdue: [], today: [], later: [], undated: [], done: [] };
    for (const t of visible) map[groupOf(t)].push(t);
    const byDue = (a: TaskRow, b: TaskRow) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (a.dueAt || '9999').localeCompare(b.dueAt || '9999');
    map.overdue.sort((a, b) => (a.dueAt || '').localeCompare(b.dueAt || ''));
    map.today.sort(byDue);
    map.later.sort((a, b) => (a.dueAt || '').localeCompare(b.dueAt || ''));
    map.undated.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.createdAt.localeCompare(a.createdAt));
    map.done.sort((a, b) => (b.completedAt || b.createdAt).localeCompare(a.completedAt || a.createdAt));
    return map;
  }, [visible]);

  const openCount = visible.length - groups.done.length;

  function openNew() {
    setForm({ ...EMPTY_FORM, assigneeId: me?.id || '' });
    setError('');
    setEditing('new');
  }

  function openEdit(task: TaskRow) {
    setForm({
      title: task.title,
      notes: task.notes || '',
      dueAt: toLocalInput(task.dueAt),
      remindAt: toLocalInput(task.remindAt),
      priority: task.priority,
      assigneeId: task.assigneeId,
      clientId: task.clientId || '',
      caseId: task.caseId || '',
      channels: task.reminderChannels,
    });
    setError('');
    setEditing(task);
  }

  function toggleChannel(channel: ReminderChannel) {
    setForm((prev) => ({
      ...prev,
      channels: prev.channels.includes(channel) ? prev.channels.filter((c) => c !== channel) : [...prev.channels, channel],
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    if (form.remindAt && form.channels.length === 0) {
      setError('בחרו איך לשלוח את התזכורת: מייל, וואטסאפ או שניהם');
      return;
    }
    setError('');
    setSaving(true);
    const isNew = editing === 'new';
    try {
      const res = await fetch(isNew ? '/api/tasks' : `/api/tasks/${editing.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          notes: form.notes,
          dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : isNew ? undefined : null,
          remindAt: form.remindAt ? new Date(form.remindAt).toISOString() : isNew ? undefined : null,
          reminderChannels: form.channels,
          priority: form.priority,
          ...(isAdmin && form.assigneeId ? { assigneeId: form.assigneeId } : {}),
          ...(isNew ? { clientId: form.clientId || undefined, caseId: form.caseId || undefined } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'המשימה לא נשמרה — נסו שוב');
        return;
      }
      setEditing(null);
      toast(isNew ? 'המשימה נוספה' : 'המשימה עודכנה');
      reload();
    } catch {
      setError('אין חיבור לשרת — המשימה לא נשמרה');
    } finally {
      setSaving(false);
    }
  }

  async function toggleDone(task: TaskRow) {
    const next = task.status === 'open' ? 'done' : 'open';
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: next, completedAt: next === 'done' ? new Date().toISOString() : undefined } : t)));
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    }).catch(() => null);
    if (!res?.ok) toast('העדכון לא נשמר', 'error');
    if (next === 'done' && res?.ok) toast('סומנה כבוצעה');
    reload();
  }

  async function removeTask(task: TaskRow) {
    if (!window.confirm(`למחוק את המשימה "${task.title}"?`)) return;
    const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) {
      setEditing(null);
      toast('המשימה נמחקה');
    } else toast('המחיקה נכשלה', 'error');
    reload();
  }

  const clientCases = cases.filter((c) => c.clientId === form.clientId);
  const editingTask = editing && editing !== 'new' ? editing : null;

  function renderTask(task: TaskRow) {
    const late = groupOf(task) === 'overdue';
    return (
      <div key={task.id} className={`task-row ${task.status === 'done' ? 'done' : ''}`}>
        <span className={`priority-mark ${task.priority}`} aria-hidden="true" />
        <button
          type="button"
          className="task-check"
          onClick={() => toggleDone(task)}
          aria-label={task.status === 'open' ? `סימון "${task.title}" כבוצעה` : `החזרת "${task.title}" לפתוחות`}
        >
          <IconCheck size={13} />
        </button>
        <div className="task-main">
          <button type="button" className="task-title" onClick={() => openEdit(task)}>
            {task.title}
            {task.priority !== 'normal' && task.status === 'open' && (
              <span className={`chip ${task.priority === 'urgent' ? 'red' : 'amber'}`} style={{ marginInlineStart: 8, height: 20 }}>
                {TASK_PRIORITY_LABELS[task.priority]}
              </span>
            )}
          </button>
          {task.notes && <div className="task-notes">{task.notes}</div>}
          <div className="task-meta">
            {task.dueAt && (
              <span className={late ? 'late' : ''}>
                <IconClock size={13} />
                {whenLabel(task.dueAt)}
              </span>
            )}
            {(isAdmin && scope === 'all') || task.assigneeId !== me?.id ? (
              <span>
                <IconUser size={13} />
                {task.assigneeName}
              </span>
            ) : null}
            {task.clientName && task.clientId && (
              <Link className="text-link" href={`/clients/${task.clientId}` as never}>
                <IconClients size={13} />
                {task.clientName}
              </Link>
            )}
            {task.caseTitle && task.caseId && (
              <Link className="text-link" href={`/cases/${task.caseId}` as never}>
                <IconFolder size={13} />
                {task.caseTitle}
              </Link>
            )}
            {task.remindAt && task.status === 'open' && (
              <span title={task.reminderSentAt ? 'התזכורת כבר נשלחה' : 'תזכורת מתוזמנת'}>
                <IconBell size={13} />
                {task.reminderSentAt ? 'נשלחה תזכורת' : `תזכורת ${whenLabel(task.remindAt)}`}
                {task.reminderChannels.length > 0 && ` · ${task.reminderChannels.map((c) => REMINDER_CHANNEL_LABELS[c]).join(' + ')}`}
              </span>
            )}
            {task.watchKind && task.status === 'open' && <span className="task-watch">{watchHint(task.watchKind)}</span>}
            {task.resolvedReason && task.status === 'done' && (
              <span className="task-watch resolved">
                <IconCheck size={13} />
                נסגרה מעצמה: {task.resolvedReason}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  const order: GroupId[] = ['overdue', 'today', 'later', 'undated'];

  return (
    <>
      <PageHead
        title="משימות"
        sub={loading ? 'טוען…' : openCount === 0 ? 'אין משימות פתוחות' : `${openCount} פתוחות${groups.overdue.length ? `, ${groups.overdue.length} באיחור` : ''}`}
        actions={
          <>
            {isAdmin && (
              <Segmented
                label="של מי"
                value={scope}
                onChange={setScope}
                options={[
                  { value: 'mine', label: 'שלי' },
                  { value: 'all', label: 'כל הצוות' },
                ]}
              />
            )}
            <button type="button" className="button" onClick={openNew}>
              <IconPlus size={16} /> משימה חדשה
            </button>
          </>
        }
      />

      {loading ? (
        <div className="stack">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 58 }} />
          ))}
        </div>
      ) : openCount === 0 && groups.done.length === 0 ? (
        <div className="card">
          <Empty
            icon={<IconTasks size={34} />}
            title="אין משימות"
            action={
              <button type="button" className="button" onClick={openNew}>
                <IconPlus size={16} /> משימה חדשה
              </button>
            }
          >
            משימה יכולה להיות שיחה ללקוח, מסמך שצריך לבקש או בדיקה מול המשרד. אפשר לקבוע לה תזכורת במייל או בוואטסאפ.
          </Empty>
        </div>
      ) : (
        <>
          {openCount === 0 && (
            <div className="notice" style={{ marginBottom: 18 }}>
              <IconCheck size={17} /> כל המשימות הפתוחות בוצעו.
            </div>
          )}
          {order.map((g) =>
            groups[g].length ? (
              <section key={g} className={`task-group ${g}`}>
                <h2 className="task-group-head">
                  {GROUP_LABELS[g]} <span className="n">{groups[g].length}</span>
                </h2>
                <div className="task-list">{groups[g].map(renderTask)}</div>
              </section>
            ) : null,
          )}
          {groups.done.length > 0 && (
            <section className="task-group done">
              <button type="button" className="button button-quiet button-compact" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
                {showDone ? 'הסתרת המשימות שבוצעו' : `הצגת המשימות שבוצעו (${groups.done.length})`}
              </button>
              {showDone && (
                <div className="task-list" style={{ marginTop: 8 }}>
                  {groups.done.slice(0, 50).map(renderTask)}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {editing && (
        <Modal
          title={editing === 'new' ? 'משימה חדשה' : 'עריכת משימה'}
          onClose={() => setEditing(null)}
          footer={
            <>
              {editingTask && (
                <button type="button" className="button button-danger button-compact" onClick={() => removeTask(editingTask)} style={{ marginInlineEnd: 'auto' }}>
                  <IconTrash size={15} /> מחיקה
                </button>
              )}
              <button type="button" className="button button-secondary" onClick={() => setEditing(null)}>
                ביטול
              </button>
              <button type="submit" form="task-form" className="button" disabled={saving}>
                {saving ? 'שומר…' : editing === 'new' ? 'הוספת המשימה' : 'שמירת השינויים'}
              </button>
            </>
          }
        >
          <form id="task-form" className="form-grid" onSubmit={submit}>
            <Field label="מה צריך לעשות" required full>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder="למשל: לבקש מהלקוח תלושי שכר" />
            </Field>
            <Field label="עד מתי">
              <input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
            </Field>
            <Field label="עדיפות">
              <Segmented
                label="עדיפות"
                value={form.priority}
                onChange={(priority) => setForm({ ...form, priority })}
                options={(Object.entries(TASK_PRIORITY_LABELS) as [TaskPriority, string][]).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            {isAdmin && (
              <Field label="באחריות">
                <select value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
                  {people.length === 0 && me && <option value={me.id}>{me.name}</option>}
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === me?.id ? `${p.name} (אני)` : p.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {editing === 'new' ? (
              <>
                <Field label="לקוח">
                  <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value, caseId: '' })}>
                    <option value="">בלי לקוח</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName}
                      </option>
                    ))}
                  </select>
                </Field>
                {form.clientId && clientCases.length > 0 && (
                  <Field label="תיק">
                    <select value={form.caseId} onChange={(e) => setForm({ ...form, caseId: e.target.value })}>
                      <option value="">כל התיקים של הלקוח</option>
                      {clientCases.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </>
            ) : (
              (editingTask?.clientName || editingTask?.caseTitle) && (
                <Field label="שייכת ל">
                  <span className="row small" style={{ minHeight: 40 }}>
                    {editingTask?.clientId && (
                      <Link className="text-link" href={`/clients/${editingTask.clientId}` as never}>
                        {editingTask.clientName}
                      </Link>
                    )}
                    {editingTask?.caseId && (
                      <Link className="text-link" href={`/cases/${editingTask.caseId}` as never}>
                        {editingTask.caseTitle}
                      </Link>
                    )}
                  </span>
                </Field>
              )
            )}
            <Field label="תזכורת" hint="נשלחת פעם אחת, בזמן שנקבע, למי שהמשימה באחריותו" full>
              <div className="row">
                <input
                  className="input"
                  type="datetime-local"
                  value={form.remindAt}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      remindAt: e.target.value,
                      channels: e.target.value && prev.channels.length === 0 ? ['email'] : prev.channels,
                    }))
                  }
                  style={{ width: 'auto', flex: '1 1 200px' }}
                  aria-label="מועד התזכורת"
                />
                {(Object.entries(REMINDER_CHANNEL_LABELS) as [ReminderChannel, string][]).map(([value, label]) => (
                  <label key={value} className="checkbox">
                    <input type="checkbox" checked={form.channels.includes(value)} onChange={() => toggleChannel(value)} disabled={!form.remindAt} />
                    {label}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="הערות" full>
              <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
            {editingTask?.reminderSentAt && form.remindAt === toLocalInput(editingTask.remindAt) && (
              <p className="notice full small">התזכורת כבר נשלחה. שינוי המועד יתזמן אותה מחדש.</p>
            )}
            {error && (
              <p className="form-error full" role="alert">
                {error}
              </p>
            )}
          </form>
        </Modal>
      )}
    </>
  );
}

export default function TasksPage() {
  const on = useConfig().modules.tasks;
  if (!on) return <ModuleOff icon={<IconTasks size={30} />} title="המשימות והתזכורות כבויות" />;
  return (
    <Suspense>
      <TasksPageInner />
    </Suspense>
  );
}
