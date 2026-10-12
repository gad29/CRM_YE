import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/admin-session';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({
    ok: true,
    role: session.scope,
    email: session.email || '',
    name: session.name || (session.scope === 'admin' ? 'מנהל' : ''),
    authDisabled: false,
  });
}
