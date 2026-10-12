import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { markChannelRead, resolveChannelForMember } from '@/lib/chat';
import { actorId, getViewer } from '@/lib/viewer';

/** Mark a conversation as read for the current user. */
export async function POST(request: NextRequest) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });

  let body: { channelId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }
  if (!body.channelId) return NextResponse.json({ ok: false, error: 'חסר מזהה שיחה' }, { status: 400 });

  const me = actorId(auth.session);
  const channel = await resolveChannelForMember(body.channelId, me);
  if (!channel) {
    return NextResponse.json({ ok: false, error: 'השיחה לא נמצאה' }, { status: 404 });
  }

  await markChannelRead(body.channelId, me);
  return NextResponse.json({ ok: true });
}
