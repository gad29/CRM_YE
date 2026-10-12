import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { canAccessChannel, getChannel, getChatMessage, readAttachment } from '@/lib/chat';
import { actorId, getViewer } from '@/lib/viewer';
import { fileResponse } from '@/lib/file-response';

/** Stream a chat attachment (image, file or voice note) to a channel member. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string; attachmentId: string }> },
) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });

  const { messageId, attachmentId } = await params;
  const message = await getChatMessage(messageId);
  if (!message) return NextResponse.json({ ok: false, error: 'ההודעה לא נמצאה' }, { status: 404 });

  const me = actorId(auth.session);
  const channel = await getChannel(message.channelId);
  if (!channel || !canAccessChannel(channel, me)) {
    return NextResponse.json({ ok: false, error: 'אין גישה' }, { status: 403 });
  }

  const found = readAttachment(message, attachmentId);
  if (!found) return NextResponse.json({ ok: false, error: 'הקובץ לא נמצא' }, { status: 404 });

  const download = request.nextUrl.searchParams.get('download') === '1';
  return fileResponse(found.buffer, { mimeType: found.attachment.mimeType, fileName: found.attachment.originalName, download });
}
