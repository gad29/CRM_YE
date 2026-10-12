import { NextResponse } from 'next/server';
import { chatUnreadCount } from '@/lib/chat';
import { actorId, getViewer } from '@/lib/viewer';

/** Unread message count for the nav badge. */
export async function GET() {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, data: { unread: await chatUnreadCount(actorId(auth.session)) } });
}
