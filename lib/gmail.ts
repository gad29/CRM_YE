// Email from the business's own Gmail account, over Gmail's SMTP with an
// App Password. Recipients see the real Gmail address, replies go to its
// inbox, and every message appears in its "Sent" folder.
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '@/lib/env';
import type { OutgoingMessage } from '@/lib/messages';

type Result = { ok: true; providerMessageId?: string } | { ok: false; error: string };

const globalForGmail = globalThis as unknown as { crmyeGmail?: { key: string; transporter: Transporter } };

function transporter() {
  // Rebuilt only if the settings change; otherwise one pooled connection is reused.
  const key = `${env.smtpHost}:${env.smtpPort}:${env.gmailUser}`;
  if (globalForGmail.crmyeGmail?.key !== key) {
    globalForGmail.crmyeGmail = {
      key,
      transporter: nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort,
        secure: env.smtpPort === 465,
        auth: { user: env.gmailUser, pass: env.gmailAppPassword },
        pool: true,
        maxConnections: 2,
        connectionTimeout: 15_000,
        socketTimeout: 20_000,
      }),
    };
  }
  return globalForGmail.crmyeGmail.transporter;
}

/** Turns Gmail's terse SMTP errors into something the Connections page can explain. */
function explain(error: unknown) {
  const text = String((error as { response?: string })?.response || (error as Error)?.message || error);
  if (/535|Username and Password not accepted|BadCredentials/i.test(text)) {
    return 'Gmail דחה את פרטי הכניסה — יש להשתמש ב"סיסמת אפליקציה" (App Password) ולא בסיסמה הרגילה';
  }
  if (/limit|quota|5\.4\.5/i.test(text)) return 'Gmail: עברתם את מכסת השליחה היומית — נסו שוב מחר';
  return `Gmail: ${text.slice(0, 200)}`;
}

export async function sendViaGmail(to: string, message: OutgoingMessage): Promise<Result> {
  try {
    const info = await transporter().sendMail({
      from: env.emailFromName ? { name: env.emailFromName, address: env.gmailUser } : env.gmailUser,
      to,
      subject: message.email.subject,
      html: message.email.html,
      text: message.email.text,
    });
    return { ok: true, providerMessageId: info.messageId };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}
