import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { canAccessChannel, deleteChatMessage, getChannel, getChatMessage } from '@/lib/chat';
import { actorId, getViewer } from '@/lib/viewer';

/** Delete a message (author, or any admin). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });

  const { messageId } = await params;
  const message = await getChatMessage(messageId);
  if (!message) return NextResponse.json({ ok: false, error: 'ההודעה לא נמצאה' }, { status: 404 });

  const me = actorId(auth.session);
  const channel = await getChannel(message.channelId);
  if (!channel || !canAccessChannel(channel, me)) {
    return NextResponse.json({ ok: false, error: 'ההודעה לא נמצאה' }, { status: 404 });
  }

  const deleted = await deleteChatMessage(messageId, me, auth.viewer.role === 'admin');
  if (!deleted) return NextResponse.json({ ok: false, error: 'אין הרשאה למחוק הודעה זו' }, { status: 403 });
  return NextResponse.json({ ok: true });
}
