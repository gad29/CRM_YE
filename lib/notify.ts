// Direct delivery: email through the business's Gmail (or Resend), WhatsApp
// through Meta's Cloud API.
// Every attempt is written to notification_log so the Connections page can
// show what went out, and Meta's delivery-status webhook can update it.
import { emailProvider, env, hasWhatsAppConfig } from '@/lib/env';
import { sendViaGmail } from '@/lib/gmail';
import { sql } from '@/lib/db';
import type { OutgoingMessage } from '@/lib/messages';

export type DeliveryChannel = 'email' | 'whatsapp';

export type DeliveryResult = { ok: true; providerMessageId?: string } | { ok: false; error: string };

/** True when the provider for this channel is configured. */
export function directChannelAvailable(channel: DeliveryChannel) {
  if (channel === 'email') return emailProvider() !== null;
  return hasWhatsAppConfig();
}

/**
 * Normalise a phone number to the digits-only international form Meta expects:
 * 050-123-4567 → 972501234567, +972 50… → 972501234567.
 */
export function normalizePhone(raw: string) {
  const digits = raw.replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+')) return digits.slice(1).replace(/\D/g, '');
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0')) return `${env.defaultCountryCode}${digits.slice(1)}`;
  return digits;
}

function maskRecipient(value: string) {
  // The log is visible in the UI; keep enough to recognise, not the whole thing.
  if (value.includes('@')) {
    const [user, domain] = value.split('@');
    return `${user.slice(0, 2)}***@${domain}`;
  }
  return value.length > 4 ? `${'*'.repeat(value.length - 4)}${value.slice(-4)}` : value;
}

async function logDelivery(entry: {
  channel: DeliveryChannel;
  provider: 'gmail' | 'resend' | 'meta';
  kind: string;
  recipient: string;
  status: 'sent' | 'failed';
  providerMessageId?: string;
  error?: string;
  relatedId?: string;
}) {
  try {
    await sql(
      `INSERT INTO notification_log (channel, provider, kind, recipient, status, provider_message_id, error, related_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.channel,
        entry.provider,
        entry.kind,
        maskRecipient(entry.recipient),
        entry.status,
        entry.providerMessageId ?? null,
        entry.error ? entry.error.slice(0, 500) : null,
        entry.relatedId ?? null,
      ],
    );
  } catch (error) {
    // Logging must never turn a successful send into a failure.
    console.error('[CRM_YE notify] could not write notification_log', String(error));
  }
}

// ── Resend ───────────────────────────────────────────────────────────────────

async function sendViaResend(to: string, message: OutgoingMessage, idempotencyKey?: string): Promise<DeliveryResult> {
  try {
    const response = await fetch(`${env.resendApiBase}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify({
        from: env.emailFrom,
        to: [to],
        subject: message.email.subject,
        html: message.email.html,
        text: message.email.text,
        ...(env.emailReplyTo ? { reply_to: env.emailReplyTo } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!response.ok) {
      return { ok: false, error: `Resend ${response.status}: ${data.message || data.name || 'unknown error'}` };
    }
    return { ok: true, providerMessageId: data.id };
  } catch (error) {
    return { ok: false, error: `Resend unreachable: ${String(error)}` };
  }
}

// ── WhatsApp Cloud API ───────────────────────────────────────────────────────

async function sendViaWhatsApp(to: string, message: OutgoingMessage): Promise<DeliveryResult> {
  const { template, params, otpButtonCode } = message.whatsapp;
  const components: Record<string, unknown>[] = [];
  if (params.length) {
    components.push({ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) });
  }
  if (otpButtonCode) {
    // Authentication templates: the copy-code button carries the code too.
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: otpButtonCode }],
    });
  }
  try {
    const response = await fetch(
      `${env.whatsappApiBase}/${env.whatsappApiVersion}/${env.whatsappPhoneNumberId}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.whatsappToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'template',
          template: { name: template, language: { code: env.whatsappTemplateLang }, components },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const data = (await response.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number; error_data?: { details?: string } };
    };
    if (!response.ok || data.error) {
      const detail = data.error?.error_data?.details || data.error?.message || 'unknown error';
      return { ok: false, error: `WhatsApp ${response.status}${data.error?.code ? ` (${data.error.code})` : ''}: ${detail}` };
    }
    return { ok: true, providerMessageId: data.messages?.[0]?.id };
  } catch (error) {
    return { ok: false, error: `WhatsApp unreachable: ${String(error)}` };
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Deliver one message on one channel. Every attempt lands in notification_log.
 */
export async function deliver(input: {
  channel: DeliveryChannel;
  to: { email?: string; phone?: string };
  message: OutgoingMessage;
  relatedId?: string;
  /** Resend de-duplicates retries carrying the same key for 24h. */
  idempotencyKey?: string;
}): Promise<DeliveryResult> {
  const { channel, message } = input;

  if (channel === 'email') {
    const to = input.to.email?.trim();
    if (!to) return { ok: false, error: 'אין כתובת אימייל' };
    const provider = emailProvider();
    if (!provider) return { ok: false, error: 'שליחת אימייל לא הוגדרה (Gmail או Resend)' };
    const result = provider === 'gmail' ? await sendViaGmail(to, message) : await sendViaResend(to, message, input.idempotencyKey);
    await logDelivery({
      channel,
      provider,
      kind: message.kind,
      recipient: to,
      status: result.ok ? 'sent' : 'failed',
      providerMessageId: result.ok ? result.providerMessageId : undefined,
      error: result.ok ? undefined : result.error,
      relatedId: input.relatedId,
    });
    return result;
  }

  // WhatsApp
  const to = normalizePhone(input.to.phone || '');
  if (!to) return { ok: false, error: 'אין מספר טלפון' };
  if (!hasWhatsAppConfig()) return { ok: false, error: 'שליחת וואטסאפ (Meta) לא הוגדרה' };
  const result = await sendViaWhatsApp(to, message);
  await logDelivery({
    channel,
    provider: 'meta',
    kind: message.kind,
    recipient: to,
    status: result.ok ? 'sent' : 'failed',
    providerMessageId: result.ok ? result.providerMessageId : undefined,
    error: result.ok ? undefined : result.error,
    relatedId: input.relatedId,
  });
  return result;
}

export async function recentNotifications(limit = 50) {
  return sql<{
    id: number;
    channel: string;
    provider: string;
    kind: string;
    recipient: string;
    status: string;
    error: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, channel, provider, kind, recipient, status, error, created_at, updated_at
       FROM notification_log ORDER BY created_at DESC, id DESC LIMIT $1`,
    [limit],
  );
}

/** Apply a Meta delivery-status update (sent → delivered → read, or failed). */
export async function applyWhatsAppStatus(providerMessageId: string, status: string, error?: string) {
  const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };
  if (!rank[status]) return;
  // Never move backwards (webhooks can arrive out of order), except to failed.
  await sql(
    `UPDATE notification_log
        SET status = $2, error = COALESCE($3, error), updated_at = now()
      WHERE provider = 'meta' AND provider_message_id = $1
        AND ($2 = 'failed' OR CASE status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END < $4)`,
    [providerMessageId, status, error ?? null, rank[status]],
  );
}
