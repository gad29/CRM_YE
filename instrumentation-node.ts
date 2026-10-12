// Server start-up (Node runtime): refuse to run with an unsafe production
// config, then start the once-a-minute reminder scheduler.
import { isProductionLike, productionConfigProblems } from '@/lib/env';
import { startReminderScheduler } from '@/lib/reminders';

if (process.env.NODE_ENV === 'production' && isProductionLike()) {
  const problems = productionConfigProblems();
  if (problems.length) {
    // Fail closed: better a server that won't start than one running with a
    // guessable session key or no login.
    console.error(`CRM_YE refuses to start — fix the server .env:\n  - ${problems.join('\n  - ')}`);
    // Exit outright: Next would otherwise keep a process alive that serves
    // nothing, which pm2 / Docker would still report as "online".
    process.exit(1);
  }
}

if (process.env.DISABLE_REMINDER_SCHEDULER !== '1') {
  startReminderScheduler();
}
