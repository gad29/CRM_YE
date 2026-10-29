import { NextResponse } from 'next/server';
import { listLoginEvents, listUsers } from '@/lib/users';
import { requireAdmin } from '@/lib/viewer';

/** Recent sign-in attempts across all accounts (admin security view). */
export async function GET() {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  const [events, users] = await Promise.all([listLoginEvents({ limit: 60 }), listUsers()]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  return NextResponse.json({
    ok: true,
    data: events.map((e) => ({ ...e, name: e.userId ? names.get(e.userId) : undefined })),
  });
}
