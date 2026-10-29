import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/admin-session';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({
    ok: true,
    id: session.accountId,
    role: session.role,
    isAdmin: session.scope === 'admin',
    email: session.email || '',
    name: session.name || '',
    mustChangePassword: session.mustChangePassword,
  });
}
