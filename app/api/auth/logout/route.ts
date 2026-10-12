import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ADMIN_AUTH_COOKIE, endSession } from '@/lib/admin-session';

export async function POST(request: NextRequest) {
  // Revoke server-side too — clearing the cookie alone would leave a copied
  // cookie usable until it expired.
  await endSession(request.cookies.get(ADMIN_AUTH_COOKIE)?.value);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_AUTH_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
