'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  REMINDER_CHANNEL_LABELS,
  TASK_PRIORITY_LABELS,
  type ReminderChannel,
  type TaskPriority,
} from '@/lib/domain';

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
};

type WorkerOption = { id: string; name: string; active: boolean };
type ClientOption = { id: string; fullName: string };

function formatDateTime(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function isOverdue(task: TaskRow) {
  return task.status === 'open' && task.dueAt && new Date(task.dueAt).getTime() < Date.now();
}

const FILTERS = [
  { id: 'open', label: 'פתוחות' },
  { id: 'today', label: 'להיום' },
  { id: 'overdue', label: 'באיחור' },
  { id: 'done', label: 'הושלמו' },
  { id: 'all', label: 'הכל' },
] as const;

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('open');
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    title: '',
    notes: '',
    dueAt: '',
    remindAt: '',
    priority: 'normal' as TaskPriority,
    assigneeId: 'admin',
    clientId: '',
    channels: [] as ReminderChannel[],
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function reload() {
    fetch('/api/tasks')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setTasks(d.data);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        const admin = d.ok && d.role === 'admin';
        setIsAdmin(admin);
        if (admin) {
          fetch('/api/workers').then((r) => r.json()).then((w) => {
            if (w.ok) setWorkers(w.data.filter((x: WorkerOption) => x.active));
          }).catch(() => null);
        }
      })
      .catch(() => null);
    fetch('/api/clients')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setClients(d.data);
      })
      .catch(() => null);
  }, []);

  const filtered = useMemo(() => {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
    switch (filter) {
      case 'open':
        return tasks.filter((t) => t.status === 'open');
      case 'today':
        return tasks.filter((t) => t.status === 'open' && t.dueAt && new Date(t.dueAt) >= startOfDay && new Date(t.dueAt) <= endOfDay);
      case 'overdue':
        return tasks.filter(isOverdue);
      case 'done':
        return tasks.filter((t) => t.status === 'done');
      default:
        return tasks;
    }
  }, [tasks, filter]);

  const sorted = useMemo(() => {
    const order: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2 };
    return [...filtered].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      if (order[a.priority] !== order[b.priority]) return order[a.priority] - order[b.priority];
      return (a.dueAt || '9999').localeCompare(b.dueAt || '9999');
    });
  }, [filtered]);

  function toggleChannel(channel: ReminderChannel) {
    setForm((prev) => ({
      ...prev,
      channels: prev.channels.includes(channel) ? prev.channels.filter((c) => c !== channel) : [...prev.channels, channel],
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          notes: form.notes || undefined,
          dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : undefined,
          remindAt: form.remindAt ? new Date(form.remindAt).toISOString() : undefined,
          reminderChannels: form.channels,
          priority: form.priority,
          assigneeId: form.assigneeId,
          clientId: form.clientId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'שמירת המשימה נכשלה');
        return;
      }
      setForm({ title: '', notes: '', dueAt: '', remindAt: '', priority: 'normal', assigneeId: 'admin', clientId: '', channels: [] });
      setShowNew(false);
      reload();
    } catch {
      setError('שגיאת תקשורת');
    } finally {
      setSaving(false);
    }
  }

  async function toggleDone(task: TaskRow) {
    await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: task.status === 'open' ? 'done' : 'open' }),
    });
    reload();
  }

  async function removeTask(task: TaskRow) {
    if (!window.confirm(`למחוק את המשימה "${task.title}"?`)) return;
    await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
    reload();
  }

  const openCount = tasks.filter((t) => t.status === 'open').length;

  return (
    <div>
      <div className="hero">
        <div>
          <p className="eyebrow">ניהול זמן</p>
          <h1 style={{ margin: '6px 0 4px' }}>משימות ותזכורות</h1>
          <p className="muted" style={{ margin: 0 }}>{openCount} משימות פתוחות</p>
        </div>
        <div className="hero-actions">
          <button className="button" type="button" onClick={() => setShowNew(true)}>+ משימה חדשה</button>
        </div>
      </div>

      {showNew && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="section-heading">
            <h3 style={{ margin: 0 }}>משימה / תזכורת חדשה</h3>
            <button type="button" className="doc-action-btn" onClick={() => setShowNew(false)}>✕ סגור</button>
          </div>
          <form onSubmit={submit}>
            <div className="form-grid cols-2">
              <div className="field field-span-2">
                <label>מה צריך לעשות? *</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required autoFocus />
              </div>
              <div className="field">
                <label>תאריך יעד</label>
                <input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
              </div>
              <div className="field">
                <label>מתי לשלוח תזכורת</label>
                <input type="datetime-local" value={form.remindAt} onChange={(e) => setForm({ ...form, remindAt: e.target.value })} />
              </div>
              <div className="field">
                <label>עדיפות</label>
                <div className="language-switch">
                  {(Object.entries(TASK_PRIORITY_LABELS) as [TaskPriority, string][]).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`language-option ${form.priority === value ? 'active' : ''}`}
                      onClick={() => setForm({ ...form, priority: value })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {isAdmin && (
                <div className="field">
                  <label>אחראי</label>
                  <select value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
                    <option value="admin">מנהל (אני)</option>
                    {workers.map((w) => (
                      <option key={w.id} value={w.id}>👤 {w.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label>שיוך ללקוח</label>
                <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
                  <option value="">ללא</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.fullName}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>ערוצי תזכורת</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(Object.entries(REMINDER_CHANNEL_LABELS) as [ReminderChannel, string][]).map(([value, label]) => (
                    <label key={value} className={`choice-card ${form.channels.includes(value) ? 'selected' : ''}`} style={{ padding: '10px 14px' }}>
                      <input type="checkbox" checked={form.channels.includes(value)} onChange={() => toggleChannel(value)} />
                      <span>{value === 'email' ? '📧' : '💬'} {label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="field">
              <label>הערות</label>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            {error && <p className="form-error">{error}</p>}
            <button className="button" type="submit" disabled={saving}>
              {saving ? 'שומר…' : 'שמור משימה'}
            </button>
          </form>
        </div>
      )}

      <div className="tab-bar">
        {FILTERS.map(({ id, label }) => (
          <button key={id} type="button" className={`tab ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card muted" style={{ padding: 24 }}>טוען משימות…</div>
      ) : sorted.length === 0 ? (
        <div className="card muted" style={{ padding: 24 }}>אין משימות בסינון זה.</div>
      ) : (
        <div className="card">
          {sorted.map((task) => (
            <div key={task.id} className={`task-row ${task.status === 'done' ? 'done' : ''}`}>
              <button type="button" className="task-check" onClick={() => toggleDone(task)} title={task.status === 'open' ? 'סמן כהושלמה' : 'פתח מחדש'}>
                ✓
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="task-title">
                  {task.title}
                  <span className={`priority-badge ${task.priority}`} style={{ marginInlineStart: 8 }}>
                    {TASK_PRIORITY_LABELS[task.priority]}
                  </span>
                </div>
                {task.notes && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{task.notes}</div>}
                <div className="task-meta">
                  {task.dueAt && (
                    <span className={isOverdue(task) ? 'task-overdue' : ''}>
                      🗓 {formatDateTime(task.dueAt)}{isOverdue(task) && ' · באיחור!'}
                    </span>
                  )}
                  <span>👤 {task.assigneeName}</span>
                  {task.clientName && task.clientId && (
                    <Link className="text-link" href={`/clients/${task.clientId}` as never}>{task.clientName}</Link>
                  )}
                  {task.caseTitle && task.caseId && (
                    <Link className="text-link" href={`/cases/${task.caseId}` as never}>{task.caseTitle}</Link>
                  )}
                  {task.remindAt && (
                    <span title={task.reminderSentAt ? 'התזכורת נשלחה' : 'תזכורת מתוזמנת'}>
                      {task.reminderSentAt ? '🔕' : '🔔'} {formatDateTime(task.remindAt)}
                      {task.reminderChannels.length > 0 && ` (${task.reminderChannels.map((c) => REMINDER_CHANNEL_LABELS[c]).join(', ')})`}
                    </span>
                  )}
                </div>
              </div>
              <button type="button" className="doc-action-btn reject" onClick={() => removeTask(task)}>
                מחיקה
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
