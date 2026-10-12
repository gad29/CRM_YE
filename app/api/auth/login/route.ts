import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { ADMIN_AUTH_COOKIE, adminCookieOptions, startSession } from '@/lib/admin-session';
import { env, hasAdminPassword } from '@/lib/env';
import { clearRateLimit, consumeRateLimit, isRateLimited } from '@/lib/rate-limit';
import { clientIp } from '@/lib/request-ip';
import { getAdminByEmail, getWorkerByEmail, logActivity } from '@/lib/store';

const WINDOW_SECONDS = 15 * 60;
/** Failed attempts allowed per account (email, or the root password) per window. */
const ACCOUNT_LIMIT = 8;
/** Failed attempts allowed per client IP per window, across all accounts. */
const IP_LIMIT = 30;

// Compared against when the email is unknown, so response time doesn't reveal
// which emails have accounts.
const DUMMY_HASH = bcrypt.hashSync('crmye-timing-equaliser', 10);

const TOO_MANY = 'יותר מדי ניסיונות כניסה שגויים. נסו שוב בעוד 15 דקות.';

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() || '';
  const password = typeof body.password === 'string' ? body.password : '';
  const ip = clientIp(request);
  const ipKey = `login-ip:${ip}`;
  const accountKey = `login-account:${email || 'root-admin'}`;

  if ((await isRateLimited(ipKey, IP_LIMIT, WINDOW_SECONDS)) || (await isRateLimited(accountKey, ACCOUNT_LIMIT, WINDOW_SECONDS))) {
    return NextResponse.json({ ok: false, error: TOO_MANY }, { status: 429 });
  }

  async function fail(message: string) {
    await consumeRateLimit(ipKey, IP_LIMIT, WINDOW_SECONDS);
    const allowed = await consumeRateLimit(accountKey, ACCOUNT_LIMIT, WINDOW_SECONDS);
    if (!allowed) {
      await logActivity({ type: 'login-locked', summary: `ננעלה זמנית הכניסה עבור ${email || 'המנהל הראשי'} אחרי ניסיונות שגויים` });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 401 });
  }

  async function succeed(input: { scope: 'admin' | 'worker'; accountId: string; email?: string; name?: string }) {
    await clearRateLimit(accountKey);
    const token = await startSession({ ...input, ip, userAgent: request.headers.get('user-agent') || undefined });
    const response = NextResponse.json({ ok: true, role: input.scope, name: input.name, email: input.email });
    response.cookies.set(ADMIN_AUTH_COOKIE, token, adminCookieOptions());
    return response;
  }

  // Email login: additional admins first, then workers.
  if (email) {
    const admin = await getAdminByEmail(email);
    if (admin) {
      const valid = await bcrypt.compare(password, admin.passwordHash);
      if (!admin.active || !valid) return fail('אימייל או סיסמה שגויים');
      return succeed({ scope: 'admin', accountId: admin.id, email: admin.email, name: admin.name });
    }

    const worker = await getWorkerByEmail(email);
    const valid = await bcrypt.compare(password, worker?.passwordHash || DUMMY_HASH);
    if (!worker || !worker.active || !valid) return fail('אימייל או סיסמה שגויים');
    return succeed({ scope: 'worker', accountId: worker.id, email: worker.email, name: worker.name });
  }

  // Root admin: password only.
  if (!hasAdminPassword()) {
    return NextResponse.json({ ok: false, error: 'לא הוגדרה סיסמת מנהל (ADMIN_PASSWORD) בשרת' }, { status: 503 });
  }
  if (!(await verifyAdminPassword(password))) return fail('סיסמה שגויה');
  return succeed({ scope: 'admin', accountId: 'admin', email: env.adminEmail });
}
