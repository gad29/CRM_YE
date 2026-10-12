// In-app reminder delivery. Runs every minute inside the server process.
//
// Due tasks are claimed with UPDATE … FOR UPDATE SKIP LOCKED, so each reminder
// is sent exactly once even with several processes. If every channel fails, the
// claim is released for another try (up to MAX_ATTEMPTS).
import { sql } from '@/lib/db';
import { taskReminderMessage } from '@/lib/messages';
import { deliver, directChannelAvailable } from '@/lib/notify';
import { getConfig, reminderContext, toTask } from '@/lib/store';

const MAX_ATTEMPTS = 3;
const BATCH = 25;

export async function processDueReminders() {
  const configured = (['email', 'whatsapp'] as const).filter((c) => directChannelAvailable(c));
  if (!configured.length) return { claimed: 0, sent: 0 };

  const rows = await sql(
    `UPDATE tasks SET reminder_sent_at = now(), reminder_attempts = reminder_attempts + 1
      WHERE id IN (SELECT id FROM tasks
                    WHERE status = 'open' AND remind_at <= now() AND reminder_sent_at IS NULL
                      AND reminder_attempts < $1
                    ORDER BY remind_at
                    LIMIT $2
                    FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [MAX_ATTEMPTS, BATCH],
  );
  if (!rows.length) return { claimed: 0, sent: 0 };

  const { businessName } = await getConfig();
  let sent = 0;
  for (const row of rows) {
    const task = toTask(row);
    const context = await reminderContext(task);
    const message = taskReminderMessage({
      businessName,
      assigneeName: context.assignee.name,
      title: task.title,
      dueAt: task.dueAt || task.remindAt,
      notes: task.notes,
      clientName: context.clientName,
      caseTitle: context.caseTitle,
      link: context.link,
    });

    // Only the channels the task asked for, that are configured, and that the
    // assignee can actually be reached on.
    const channels = task.reminderChannels.filter(
      (c) => configured.includes(c) && (c === 'email' ? context.assignee.email : context.assignee.phone),
    );
    if (!channels.length) continue; // nothing deliverable — the claim stands so it isn't retried forever

    let anyOk = false;
    for (const channel of channels) {
      const result = await deliver({
        channel,
        to: { email: context.assignee.email, phone: context.assignee.phone },
        message,
        relatedId: task.id,
        // Resend drops a duplicate if a retry repeats an email that did go out.
        idempotencyKey: `reminder-${task.id}-${task.remindAt}`,
      });
      if (result.ok) anyOk = true;
    }
    if (anyOk) {
      sent += 1;
    } else {
      // Release the claim so the next tick retries (attempts already counted).
      await sql('UPDATE tasks SET reminder_sent_at = NULL WHERE id = $1', [task.id]);
    }
  }
  return { claimed: rows.length, sent };
}

const globalForScheduler = globalThis as unknown as { crmyeReminderTimer?: NodeJS.Timeout };

/** Start the once-a-minute loop (idempotent — dev hot reload won't stack timers). */
export function startReminderScheduler() {
  if (globalForScheduler.crmyeReminderTimer) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await processDueReminders();
      if (result.claimed) console.info(`[CRM_YE reminders] claimed ${result.claimed}, sent ${result.sent}`);
    } catch (error) {
      console.error('[CRM_YE reminders] tick failed', String(error));
    } finally {
      running = false;
    }
  };
  globalForScheduler.crmyeReminderTimer = setInterval(tick, 60_000);
  globalForScheduler.crmyeReminderTimer.unref?.();
  setTimeout(tick, 5_000).unref?.();
}
