import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { directChannelAvailable } from '@/lib/notify';
import { consumeRateLimit } from '@/lib/rate-limit';
import { clientIp } from '@/lib/request-ip';
import { requestPasswordReset } from '@/lib/users';

/**
 * Public: requests a password-reset code by email (Resend) or WhatsApp (Meta).
 * Responds identically whether or not the email exists.
 */
export async function POST(request: NextRequest) {
  let body: { email?: string; channel?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@') || email.length > 200) {
    return NextResponse.json({ ok: false, error: 'נא להזין כתובת אימייל תקינה' }, { status: 400 });
  }

  const channel = body.channel === 'whatsapp' ? 'whatsapp' : 'email';
  if (!directChannelAvailable(channel)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          channel === 'email'
            ? 'שליחת קוד באימייל לא הוגדרה בשרת. פנו למנהל המערכת.'
            : 'שליחת קוד בוואטסאפ לא הוגדרה בשרת. נסו באימייל או פנו למנהל המערכת.',
      },
      { status: 503 },
    );
  }

  if (!(await consumeRateLimit(`forgot-ip:${clientIp(request)}`, 10, 60 * 60))) {
    return NextResponse.json({ ok: false, error: 'יותר מדי בקשות. נסו שוב בעוד שעה.' }, { status: 429 });
  }

  await requestPasswordReset(email, channel);
  // Always the same answer — email enumeration is not possible.
  return NextResponse.json({ ok: true });
}
