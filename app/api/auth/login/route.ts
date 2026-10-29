import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { ADMIN_AUTH_COOKIE, adminCookieOptions, startSession } from '@/lib/admin-session';
import { clearRateLimit, consumeRateLimit, isRateLimited } from '@/lib/rate-limit';
import { clientIp } from '@/lib/request-ip';
import { logActivity } from '@/lib/store';
import { getUserByEmail, isAdminRole, logLoginEvent, recordLogin } from '@/lib/users';

const WINDOW_SECONDS = 15 * 60;
/** Failed attempts allowed per account per window. */
const ACCOUNT_LIMIT = 8;
/** Failed attempts allowed per client IP per window, across all accounts. */
const IP_LIMIT = 30;

// Compared against when the email is unknown, so response time doesn't reveal
// which emails have accounts.
const DUMMY_HASH = bcrypt.hashSync('crmye-timing-equaliser', 10);

const WRONG = 'האימייל או הסיסמה שגויים';
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
  if (!email || !password) return NextResponse.json({ ok: false, error: 'נא להזין אימייל וסיסמה' }, { status: 400 });

  const ip = clientIp(request);
  const userAgent = request.headers.get('user-agent') || undefined;
  const ipKey = `login-ip:${ip}`;
  const accountKey = `login-account:${email}`;

  if ((await isRateLimited(ipKey, IP_LIMIT, WINDOW_SECONDS)) || (await isRateLimited(accountKey, ACCOUNT_LIMIT, WINDOW_SECONDS))) {
    await logLoginEvent({ email, success: false, reason: 'locked', ip, userAgent });
    return NextResponse.json({ ok: false, error: TOO_MANY }, { status: 429 });
  }

  const user = await getUserByEmail(email);
  const valid = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);

  if (!user || !valid || !user.active) {
    await consumeRateLimit(ipKey, IP_LIMIT, WINDOW_SECONDS);
    const allowed = await consumeRateLimit(accountKey, ACCOUNT_LIMIT, WINDOW_SECONDS);
    const reason = !user ? 'unknown-email' : !valid ? 'wrong-password' : 'inactive';
    await logLoginEvent({ userId: user?.id, email, success: false, reason, ip, userAgent });
    if (!allowed && user) {
      await logActivity({ type: 'login-locked', summary: `ננעלה זמנית הכניסה של ${user.name} אחרי ניסיונות שגויים` });
    }
    // An inactive account gets the same answer — no hint that it exists.
    return NextResponse.json({ ok: false, error: WRONG }, { status: 401 });
  }

  await clearRateLimit(accountKey);
  await recordLogin(user.id);
  await logLoginEvent({ userId: user.id, email, success: true, ip, userAgent });

  const token = await startSession({
    scope: isAdminRole(user.role) ? 'admin' : 'worker',
    accountId: user.id,
    email: user.email,
    name: user.name,
    ip,
    userAgent,
  });
  const response = NextResponse.json({
    ok: true,
    role: user.role,
    name: user.name,
    mustChangePassword: user.mustChangePassword,
  });
  response.cookies.set(ADMIN_AUTH_COOKIE, token, adminCookieOptions());
  return response;
}
