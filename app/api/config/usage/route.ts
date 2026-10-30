import { NextResponse } from 'next/server';
import { configUsage } from '@/lib/store';
import { requireAdmin } from '@/lib/viewer';

/** Admin-only: cases per stage and how often each added field is filled, for the Settings editors. */
export async function GET() {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  return NextResponse.json({ ok: true, data: await configUsage() });
}
