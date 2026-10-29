'use client';

// Corner reminders for urgent / overdue tasks. Checks every minute (only while
// the tab is visible); "later" hides an alert for this browser session. Opens
// when a new alert arrives, then folds into a small pill so it never sits on
// top of the page's own content.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { IconX } from '@/components/ui/icons';

type Task = { id: string; title: string; status: string; priority: string; dueAt?: string; clientName?: string };
const KEY = 'crmye-dismissed-alerts';
const SEEN_KEY = 'crmye-seen-alerts';

function readList(key: string): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
}

function writeList(key: string, ids: string[]) {
  try {
    sessionStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* fine — it just comes back next load */
  }
}

const dismissed = () => readList(KEY);

export function TaskAlerts() {
  const [alerts, setAlerts] = useState<Task[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (document.visibilityState !== 'visible') return;
      try {
        const d = await fetch('/api/tasks').then((r) => r.json());
        if (!d.ok || cancelled) return;
        const now = Date.now();
        const hidden = dismissed();
        const next = (d.data as Task[])
          .filter((t) => t.status === 'open' && t.dueAt && !hidden.includes(t.id))
          .filter((t) => (t.priority === 'urgent' ? new Date(t.dueAt!).getTime() <= now + 86_400_000 : new Date(t.dueAt!).getTime() < now))
          .slice(0, 3);
        const seen = readList(SEEN_KEY);
        if (next.some((t) => !seen.includes(t.id))) {
          setOpen(true);
          writeList(SEEN_KEY, [...seen, ...next.map((t) => t.id)]);
        }
        setAlerts(next);
      } catch {
        /* offline — try again next minute */
      }
    }
    void check();
    const t = setInterval(check, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  function hide(id: string) {
    writeList(KEY, [...dismissed(), id]);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  async function done(id: string) {
    await fetch(`/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }) });
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  if (!alerts.length) return null;
  if (!open) {
    return (
      <div className="task-alerts" aria-live="polite">
        <button type="button" className="task-alert-pill" onClick={() => setOpen(true)}>
          <span className="task-alert-dot" aria-hidden="true" />
          {alerts.length === 1 ? 'משימה אחת דורשת טיפול' : `${alerts.length} משימות דורשות טיפול`}
        </button>
      </div>
    );
  }
  return (
    <div className="task-alerts" aria-live="polite">
      <button type="button" className="text-link small task-alerts-fold" onClick={() => setOpen(false)}>
        מזעור
      </button>
      {alerts.map((t) => {
        const overdue = new Date(t.dueAt!).getTime() < Date.now();
        return (
          <div key={t.id} className={`task-alert ${t.priority === 'urgent' ? 'urgent' : ''}`}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="task-alert-title truncate">{t.title}</div>
              <div className="task-alert-meta">
                {overdue ? 'עבר המועד' : 'דחוף · היום'}
                {t.clientName ? ` · ${t.clientName}` : ''}
              </div>
              <div className="row" style={{ marginTop: 8, gap: 6 }}>
                <button type="button" className="button button-compact" onClick={() => done(t.id)}>
                  סימון כבוצע
                </button>
                <Link href={'/tasks' as never} className="button button-secondary button-compact">
                  למשימות
                </Link>
              </div>
            </div>
            <button type="button" className="icon-button small" onClick={() => hide(t.id)} aria-label="הסתרה עד הכניסה הבאה">
              <IconX size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
