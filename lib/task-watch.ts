// Reminders that watch data. A reminder created from a gap (a missing
// document, a case still missing documents, an unpaid fee, missing client
// details) checks that gap; once it is filled the reminder closes itself, so
// nobody gets nagged about something that already arrived.
//
// Checked whenever tasks are listed (the app polls every minute) and by the
// reminder scheduler just before anything is sent.
import {
  CHECKLIST_STATUS_LABELS,
  CLIENT_DETAIL_LABELS,
  TASK_WATCH_KINDS,
  checklistItemIsMissing,
  countMissingItems,
  type ClientDetailField,
  type TaskRecord,
  type TaskWatchKind,
} from '@/lib/domain';
import { sql } from '@/lib/db';
import { getCase, getCaseFinance, getClient, listCasePayments, logActivity, toTask } from '@/lib/store';

type Watched = Pick<TaskRecord, 'watchKind' | 'watchRef' | 'caseId' | 'clientId'>;

export function isWatchKind(value: unknown): value is TaskWatchKind {
  return TASK_WATCH_KINDS.includes(value as TaskWatchKind);
}

export function parseDetailFields(ref?: string): ClientDetailField[] {
  return (ref || '').split(',').filter((f): f is ClientDetailField => f in CLIENT_DETAIL_LABELS);
}

/** Why the watched gap is filled, or null while it is still open. */
export async function watchResolution(task: Watched): Promise<string | null> {
  if (!task.watchKind) return null;

  if (task.watchKind === 'client-details') {
    const client = task.clientId ? await getClient(task.clientId) : undefined;
    if (!client) return 'הלקוח נמחק';
    const fields = parseDetailFields(task.watchRef);
    return fields.length && fields.every((f) => client[f]?.trim()) ? 'הפרטים הושלמו' : null;
  }

  const caseRecord = task.caseId ? await getCase(task.caseId) : undefined;
  if (!caseRecord) return 'התיק נמחק';
  if (caseRecord.stage === 'closed') return 'התיק נסגר';

  switch (task.watchKind) {
    case 'checklist-item': {
      const item = caseRecord.checklist.find((i) => i.code === task.watchRef);
      if (!item) return 'המסמך הוסר מהרשימה';
      return checklistItemIsMissing(item) ? null : `"${item.label}" — ${CHECKLIST_STATUS_LABELS[item.status]}`;
    }
    case 'case-documents':
      return countMissingItems(caseRecord) === 0 ? 'כל המסמכים התקבלו' : null;
    case 'case-payment': {
      const finance = getCaseFinance(caseRecord, await listCasePayments(caseRecord.id));
      return finance.status === 'paid' || (caseRecord.fee > 0 && finance.balance <= 0) ? 'התשלום התקבל' : null;
    }
  }
  return null;
}

/** Close every open watching reminder whose gap is filled. Returns how many closed. */
export async function resolveWatchedTasks() {
  const rows = await sql(`SELECT * FROM tasks WHERE status = 'open' AND watch_kind IS NOT NULL`);
  let closed = 0;
  for (const row of rows) {
    const task = toTask(row);
    const reason = await watchResolution(task);
    if (!reason) continue;
    const updated = await sql(
      `UPDATE tasks SET status = 'done', completed_at = now(), updated_at = now(), resolved_reason = $2
        WHERE id = $1 AND status = 'open' RETURNING id`,
      [task.id, reason],
    );
    if (!updated.length) continue; // closed meanwhile by someone else
    closed += 1;
    await logActivity({
      type: 'task-auto-closed',
      clientId: task.clientId,
      caseId: task.caseId,
      summary: `תזכורת נסגרה מעצמה: "${task.title}" — ${reason}`,
    });
  }
  return closed;
}
