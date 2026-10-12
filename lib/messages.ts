// Outgoing message content: a Hebrew RTL email and the matching WhatsApp
// template parameters for every notification the CRM sends.
//
// WhatsApp business-initiated messages must use templates pre-approved by Meta.
// The template names come from env (WHATSAPP_TEMPLATE_*); their exact wording
// for submission is in docs/WHATSAPP-SETUP.md. Parameter ORDER here must
// match the {{1}}, {{2}}… placeholders in those templates.
import { env } from '@/lib/env';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface WhatsAppContent {
  template: string;
  /** Body placeholders {{1}}..{{n}} in order. */
  params: string[];
  /** Authentication templates repeat the code in their copy-code button. */
  otpButtonCode?: string;
}

export interface OutgoingMessage {
  kind: 'password-reset' | 'documents' | 'reminder' | 'task-assigned' | 'chat' | 'test';
  email: EmailContent;
  whatsapp: WhatsAppContent;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** Meta rejects template parameters containing newlines, tabs or 4+ spaces. */
export function whatsappParam(value: string, max = 900) {
  const clean = value.replace(/[\r\n\t]+/g, ' · ').replace(/ {2,}/g, ' ').trim();
  return (clean || '—').slice(0, max);
}

function formatDateTime(isoValue?: string) {
  if (!isoValue) return '';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return isoValue;
  return date.toLocaleString('he-IL', {
    timeZone: process.env.APP_TIMEZONE || 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Shared RTL email shell: header with the business name, paragraphs, optional button. */
function emailLayout(input: {
  businessName: string;
  heading: string;
  paragraphs: string[];
  button?: { label: string; href: string };
  code?: string;
  footer?: string;
}) {
  const p = input.paragraphs
    .map((line) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#1e293b">${escapeHtml(line)}</p>`)
    .join('');
  const code = input.code
    ? `<div style="margin:18px 0;padding:14px;border-radius:12px;background:#eff6ff;text-align:center;font-size:30px;font-weight:700;letter-spacing:8px;color:#1d4ed8;direction:ltr">${escapeHtml(input.code)}</div>`
    : '';
  const button = input.button
    ? `<div style="margin:22px 0"><a href="${escapeHtml(input.button.href)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px;font-size:15px">${escapeHtml(input.button.label)}</a></div>`
    : '';
  const footer = input.footer
    ? `<p style="margin:18px 0 0;font-size:12px;color:#94a3b8">${escapeHtml(input.footer)}</p>`
    : '';
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,'Segoe UI',sans-serif;direction:rtl;text-align:right">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
<div style="background:#2563eb;color:#ffffff;padding:16px 24px;font-size:17px;font-weight:700">${escapeHtml(input.businessName)}</div>
<div style="padding:24px">
<h1 style="margin:0 0 16px;font-size:20px;color:#0f172a">${escapeHtml(input.heading)}</h1>
${p}${code}${button}${footer}
</div></div></body></html>`;
}

function textLayout(lines: (string | undefined)[]) {
  return lines.filter(Boolean).join('\n');
}

// ── Builders ────────────────────────────────────────────────────────────────

export function passwordResetMessage(input: { businessName: string; name: string; code: string; minutes: number }): OutgoingMessage {
  const intro = `שלום ${input.name}, התקבלה בקשה לאיפוס הסיסמה שלך למערכת.`;
  const validity = `הקוד בתוקף ל-${input.minutes} דקות. אם לא ביקשת איפוס, אפשר להתעלם מהודעה זו.`;
  return {
    kind: 'password-reset',
    email: {
      subject: `קוד איפוס סיסמה — ${input.businessName}`,
      html: emailLayout({ businessName: input.businessName, heading: 'איפוס סיסמה', paragraphs: [intro, 'קוד האימות שלך:'], code: input.code, footer: validity }),
      text: textLayout([intro, `קוד האימות: ${input.code}`, validity]),
    },
    // Authentication templates take only the code — Meta supplies the wording.
    whatsapp: { template: env.whatsappTemplates.otp, params: [input.code], otpButtonCode: input.code },
  };
}

export function documentsLinkMessage(input: {
  businessName: string;
  clientName: string;
  label: string;
  link: string;
  days: number;
}): OutgoingMessage {
  const intro = `שלום ${input.clientName}, ${input.businessName} שלח/ה לך ${input.label}.`;
  const validity = `הקישור מאובטח ובתוקף ל-${input.days} ימים.`;
  return {
    kind: 'documents',
    email: {
      subject: `${input.label} מ${input.businessName}`,
      html: emailLayout({
        businessName: input.businessName,
        heading: 'מסמכים עבורך',
        paragraphs: [intro, 'לצפייה ולהורדה לחצו על הכפתור:'],
        button: { label: 'צפייה במסמכים', href: input.link },
        footer: validity,
      }),
      text: textLayout([intro, `לצפייה ולהורדה: ${input.link}`, validity]),
    },
    whatsapp: {
      template: env.whatsappTemplates.documents,
      params: [input.clientName, input.businessName, input.label, input.link, String(input.days)].map((v) => whatsappParam(v)),
    },
  };
}

export function taskReminderMessage(input: {
  businessName: string;
  assigneeName: string;
  title: string;
  dueAt?: string;
  notes?: string;
  clientName?: string;
  caseTitle?: string;
  link: string;
}): OutgoingMessage {
  const when = formatDateTime(input.dueAt) || 'ללא מועד';
  const context = [input.clientName && `לקוח: ${input.clientName}`, input.caseTitle && `תיק: ${input.caseTitle}`]
    .filter(Boolean)
    .join(' · ');
  return {
    kind: 'reminder',
    email: {
      subject: `⏰ תזכורת: ${input.title}`,
      html: emailLayout({
        businessName: input.businessName,
        heading: `תזכורת: ${input.title}`,
        paragraphs: [`שלום ${input.assigneeName},`, `מועד: ${when}`, context, input.notes || ''].filter(Boolean),
        button: { label: 'פתיחת המשימות', href: input.link },
      }),
      text: textLayout([`תזכורת: ${input.title}`, `מועד: ${when}`, context, input.notes, input.link]),
    },
    whatsapp: {
      template: env.whatsappTemplates.reminder,
      params: [input.assigneeName, input.title, when, context || input.notes || '—'].map((v) => whatsappParam(v)),
    },
  };
}

export function taskAssignedMessage(input: {
  businessName: string;
  assigneeName: string;
  title: string;
  dueAt?: string;
  notes?: string;
  link: string;
}): OutgoingMessage {
  const when = formatDateTime(input.dueAt) || 'ללא מועד';
  return {
    kind: 'task-assigned',
    email: {
      subject: `משימה חדשה: ${input.title}`,
      html: emailLayout({
        businessName: input.businessName,
        heading: 'שויכה אליך משימה חדשה',
        paragraphs: [`שלום ${input.assigneeName},`, `משימה: ${input.title}`, `מועד: ${when}`, input.notes || ''].filter(Boolean),
        button: { label: 'פתיחת המשימות', href: input.link },
      }),
      text: textLayout([`שויכה אליך משימה: ${input.title}`, `מועד: ${when}`, input.notes, input.link]),
    },
    whatsapp: {
      template: env.whatsappTemplates.taskAssigned,
      params: [input.assigneeName, input.title, when].map((v) => whatsappParam(v)),
    },
  };
}

export function chatMessageNotice(input: {
  businessName: string;
  recipientName: string;
  authorName: string;
  channelName: string;
  preview: string;
  link: string;
}): OutgoingMessage {
  return {
    kind: 'chat',
    email: {
      subject: `הודעה חדשה מ${input.authorName}`,
      html: emailLayout({
        businessName: input.businessName,
        heading: `הודעה חדשה מ${input.authorName}`,
        paragraphs: [`שלום ${input.recipientName},`, `ב${input.channelName}:`, input.preview],
        button: { label: 'פתיחת הצ׳אט', href: input.link },
      }),
      text: textLayout([`הודעה חדשה מ${input.authorName} (${input.channelName}):`, input.preview, input.link]),
    },
    whatsapp: {
      template: env.whatsappTemplates.chat,
      params: [input.recipientName, input.authorName, input.preview].map((v) => whatsappParam(v, 300)),
    },
  };
}

/** Sent from the Connections page to prove a provider works end-to-end. */
export function testMessage(input: { businessName: string; name: string }): OutgoingMessage {
  return {
    kind: 'test',
    email: {
      subject: `בדיקת חיבור אימייל — ${input.businessName}`,
      html: emailLayout({
        businessName: input.businessName,
        heading: 'החיבור עובד ✓',
        paragraphs: [`שלום ${input.name}, זו הודעת בדיקה ממערכת ${input.businessName}.`, 'אם קיבלת אותה — שליחת האימיילים מוגדרת כראוי.'],
      }),
      text: `שלום ${input.name}, זו הודעת בדיקה ממערכת ${input.businessName}. שליחת האימיילים מוגדרת כראוי.`,
    },
    // A reminder-template test exercises the same path real reminders take.
    whatsapp: {
      template: env.whatsappTemplates.reminder,
      params: [input.name, 'בדיקת חיבור וואטסאפ', formatDateTime(new Date().toISOString()), 'אם קיבלת הודעה זו — החיבור תקין'].map((v) =>
        whatsappParam(v),
      ),
    },
  };
}
