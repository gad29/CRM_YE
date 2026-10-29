export const env = {
  /** Admin login: plain password or bcrypt hash (hash wins when both are set). */
  adminPassword: process.env.ADMIN_PASSWORD,
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH,
  adminEmail: process.env.ADMIN_EMAIL || 'admin@crmye.local',
  /** Admin phone for WhatsApp reminders (international format). */
  adminPhone: process.env.ADMIN_PHONE || '',
  adminSessionSecret: process.env.ADMIN_SESSION_SECRET,
  adminSessionHours: process.env.ADMIN_SESSION_HOURS || '24',

  appBaseUrl: (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),

  /** Header the reverse proxy puts the real client IP in (nginx: x-real-ip, Caddy: x-forwarded-for). */
  clientIpHeader: (process.env.CLIENT_IP_HEADER || 'x-real-ip').toLowerCase(),

  /** Root folder for client document folders, chat files and templates. */
  dataDir: process.env.DATA_DIR || './data',
  uploadMaxFileBytes: (() => {
    const raw = process.env.UPLOAD_MAX_FILE_BYTES;
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
    return 25 * 1024 * 1024;
  })(),

  // ── Email via the business's own Gmail (preferred when set) ───────────────
  /** The Gmail address mail is sent from — recipients see this address. */
  gmailUser: (process.env.GMAIL_USER || '').trim(),
  /** 16-character Google "App Password" (needs 2-Step Verification on). */
  gmailAppPassword: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''),
  /** Display name next to the address, e.g. "יוסי כהן — ייעוץ זכויות". */
  emailFromName: process.env.EMAIL_FROM_NAME || '',
  /** Testing only — point at a local SMTP server instead of smtp.gmail.com. */
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: Number(process.env.SMTP_PORT || 465),

  // ── Email via Resend ───────────────────────────────────────────────────────
  resendApiKey: process.env.RESEND_API_KEY || '',
  /** Testing only — point at a local fake instead of the real API. */
  resendApiBase: (process.env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/$/, ''),
  /** Verified sender, e.g. "משרד יעוץ <noreply@your-domain.co.il>". */
  emailFrom: process.env.EMAIL_FROM || '',
  emailReplyTo: process.env.EMAIL_REPLY_TO || '',

  // ── WhatsApp via Meta Cloud API ────────────────────────────────────────────
  whatsappToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  whatsappApiVersion: process.env.WHATSAPP_API_VERSION || 'v23.0',
  /** Testing only — point at a local fake instead of the real Graph API. */
  whatsappApiBase: (process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com').replace(/\/$/, ''),
  /** App secret — verifies the X-Hub-Signature-256 of delivery-status webhooks. */
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET || '',
  /** Any string; typed into Meta's webhook setup to prove we own the endpoint. */
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
  whatsappTemplateLang: process.env.WHATSAPP_TEMPLATE_LANG || 'he',
  /** Country code prepended to local numbers like 050-1234567. */
  defaultCountryCode: (process.env.DEFAULT_COUNTRY_CODE || '972').replace(/\D/g, ''),
  whatsappTemplates: {
    otp: process.env.WHATSAPP_TEMPLATE_OTP || 'crmye_password_reset',
    documents: process.env.WHATSAPP_TEMPLATE_DOCUMENTS || 'crmye_documents_link',
    reminder: process.env.WHATSAPP_TEMPLATE_REMINDER || 'crmye_task_reminder',
    taskAssigned: process.env.WHATSAPP_TEMPLATE_TASK_ASSIGNED || 'crmye_task_assigned',
    chat: process.env.WHATSAPP_TEMPLATE_CHAT || 'crmye_chat_message',
  },
};

export function looksLikePlaceholder(value?: string | null) {
  if (!value) return true;
  return value.includes('example.com') || value.includes('change-me') || value.includes('replace-with-');
}

export function hasAdminPassword() {
  return Boolean(
    (env.adminPasswordHash && !looksLikePlaceholder(env.adminPasswordHash)) ||
    (env.adminPassword && !looksLikePlaceholder(env.adminPassword)),
  );
}

export function hasGmailConfig() {
  return Boolean(env.gmailUser.includes('@') && env.gmailAppPassword.length >= 16);
}

/** Which email provider sends mail: the business's Gmail first, else Resend. */
export function emailProvider(): 'gmail' | 'resend' | null {
  if (hasGmailConfig()) return 'gmail';
  if (hasResendConfig()) return 'resend';
  return null;
}

export function hasResendConfig() {
  return Boolean(env.resendApiKey && env.emailFrom && !looksLikePlaceholder(env.resendApiKey));
}

export function hasWhatsAppConfig() {
  return Boolean(env.whatsappToken && env.whatsappPhoneNumberId && !looksLikePlaceholder(env.whatsappToken));
}

export function hasLiveAppBaseUrl() {
  return Boolean(env.appBaseUrl && !env.appBaseUrl.includes('localhost'));
}

export function isProductionLike() {
  return process.env.NODE_ENV === 'production' || hasLiveAppBaseUrl();
}

/**
 * Problems that make a production deployment unsafe to run. The server
 * refuses to start while any exist (see instrumentation.ts) — failing closed
 * beats silently running with a guessable session secret or no login at all.
 */
export function productionConfigProblems(): string[] {
  const problems: string[] = [];
  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL is not set');
  if (!hasAdminPassword()) problems.push('ADMIN_PASSWORD or ADMIN_PASSWORD_HASH must be set to a real value');
  const secret = env.adminSessionSecret || '';
  if (secret.length < 32 || looksLikePlaceholder(secret)) {
    problems.push('ADMIN_SESSION_SECRET must be a random string of at least 32 characters (openssl rand -hex 32)');
  }
  if (!/^https:\/\//.test(env.appBaseUrl)) problems.push('APP_BASE_URL must be the public https:// address of the site');
  return problems;
}
