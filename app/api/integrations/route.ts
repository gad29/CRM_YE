import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { testMessage } from '@/lib/messages';
import { deliver, directChannelAvailable, recentNotifications } from '@/lib/notify';
import { consumeRateLimit } from '@/lib/rate-limit';
import { getConfig } from '@/lib/store';
import { requireAdmin } from '@/lib/viewer';

/** Admin-only: recent deliveries for the Connections page. */
export async function GET() {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  const rows = await recentNotifications(50);
  return NextResponse.json({ ok: true, log: rows });
}

/** Admin-only: send a test email / WhatsApp to prove a provider works end-to-end. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  let body: { channel?: string; to?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }
  const channel = body.channel === 'whatsapp' ? 'whatsapp' : 'email';
  const to = (body.to || '').trim();
  if (!to) return NextResponse.json({ ok: false, error: 'נא להזין נמען' }, { status: 400 });
  if (!directChannelAvailable(channel)) {
    return NextResponse.json({ ok: false, error: channel === 'email' ? 'שליחת מייל עדיין לא הוגדרה בשרת' : 'וואטסאפ עדיין לא הוגדר בשרת' }, { status: 503 });
  }
  if (!(await consumeRateLimit(`integration-test:${auth.session.accountId}`, 20, 60 * 60))) {
    return NextResponse.json({ ok: false, error: 'יותר מדי הודעות בדיקה — נסו שוב בעוד שעה' }, { status: 429 });
  }

  const { businessName } = await getConfig();
  const result = await deliver({
    channel,
    to: channel === 'email' ? { email: to } : { phone: to },
    message: testMessage({ businessName, name: auth.session.name || 'מנהל' }),
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
