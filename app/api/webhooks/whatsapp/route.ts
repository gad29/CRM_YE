import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { applyWhatsAppStatus } from '@/lib/notify';

/**
 * Meta WhatsApp Cloud API webhook (public; see middleware).
 * GET  — one-time verification handshake when the webhook is configured.
 * POST — delivery-status updates (sent / delivered / read / failed), signed
 *        with the app secret in X-Hub-Signature-256.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token') || '';
  const challenge = params.get('hub.challenge') || '';
  const expected = env.whatsappVerifyToken;
  if (
    mode === 'subscribe' &&
    expected &&
    token.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  ) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

type StatusPayload = {
  entry?: {
    changes?: {
      value?: {
        statuses?: { id?: string; status?: string; errors?: { title?: string; message?: string; code?: number }[] }[];
      };
    }[];
  }[];
};

export async function POST(request: NextRequest) {
  // Without the app secret we can't tell Meta from a forger — accept nothing.
  if (!env.whatsappAppSecret) return new NextResponse('Webhook secret not configured', { status: 401 });

  const raw = await request.text();
  const signature = request.headers.get('x-hub-signature-256') || '';
  const expected = `sha256=${crypto.createHmac('sha256', env.whatsappAppSecret).update(raw).digest('hex')}`;
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return new NextResponse('Invalid signature', { status: 401 });
  }

  let payload: StatusPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse('Bad JSON', { status: 400 });
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const status of change.value?.statuses ?? []) {
        if (!status.id || !status.status) continue;
        const error = status.errors?.[0];
        await applyWhatsAppStatus(
          status.id,
          status.status,
          error ? `${error.code ?? ''} ${error.title || error.message || ''}`.trim() : undefined,
        );
      }
    }
  }
  // Meta retries anything but a 200, so acknowledge even when nothing matched.
  return NextResponse.json({ ok: true });
}
