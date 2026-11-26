import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createApiKey, listApiKeys, recentKeyRequests } from '@/lib/api-keys';
import type { SessionPayload } from '@/lib/admin-session';
import { listUsers, type UserRecord } from '@/lib/users';
import { actorId, requireAdmin } from '@/lib/viewer';

const EXPIRY_DAYS = new Set([30, 90, 365]);

/** Whose access a key made by this person may carry: the owner any account, an admin their own or a worker's. */
function canActAs(session: SessionPayload, user: UserRecord) {
  if (!user.active) return false;
  if (session.role === 'owner') return true;
  return user.id === session.accountId || user.role === 'worker';
}

/** The keys, what they did lately, and the accounts a new key may act as. */
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const [keys, requests, users] = await Promise.all([listApiKeys(), recentKeyRequests(40), listUsers()]);
  return NextResponse.json({
    ok: true,
    data: {
      keys,
      requests,
      accounts: users.filter((u) => canActAs(auth.session, u)).map((u) => ({ id: u.id, name: u.name, role: u.role })),
    },
  });
}

/** Create a key. The key itself is in this response only; the server keeps a hash. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  let body: { name?: string; accountId?: string; canWrite?: boolean; expiresInDays?: number | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ ok: false, error: 'תנו למפתח שם, למשל "הבוט שלי"' }, { status: 400 });

  const accountId = body.accountId || actorId(auth.session);
  const user = (await listUsers()).find((u) => u.id === accountId);
  if (!user || !canActAs(auth.session, user)) {
    return NextResponse.json({ ok: false, error: 'אי אפשר ליצור מפתח בשם החשבון הזה' }, { status: 403 });
  }
  const days = body.expiresInDays ? Number(body.expiresInDays) : undefined;
  if (days !== undefined && !EXPIRY_DAYS.has(days)) {
    return NextResponse.json({ ok: false, error: 'תוקף לא תקין' }, { status: 400 });
  }

  const { record, key } = await createApiKey({
    name,
    accountId,
    canWrite: body.canWrite === true,
    createdBy: actorId(auth.session),
    expiresInDays: days,
  });
  return NextResponse.json({ ok: true, data: { key: record, secret: key } }, { status: 201 });
}
