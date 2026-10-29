import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/store';

/** Public: just the business name and subtitle, for the sign-in screen. */
export async function GET() {
  const { businessName, sidebarSubtitle } = await getConfig();
  return NextResponse.json({ ok: true, data: { businessName, sidebarSubtitle } }, { headers: { 'Cache-Control': 'no-store' } });
}
