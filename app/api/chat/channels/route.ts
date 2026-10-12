import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getOrCreateDirectChannel, listChatMembers, listConversations } from '@/lib/chat';
import { actorId, getViewer } from '@/lib/viewer';

/** Conversations visible to me + the team roster. */
export async function GET() {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });

  const me = actorId(auth.session);
  return NextResponse.json({
    ok: true,
    data: {
      me,
      conversations: await listConversations(me),
      members: (await listChatMembers()).filter((m) => m.active),
    },
  });
}

/** Open (or fetch) a 1:1 conversation with another member. */
export async function POST(request: NextRequest) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });

  let body: { memberId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }
  if (!body.memberId) return NextResponse.json({ ok: false, error: 'חסר מזהה משתמש' }, { status: 400 });

  const channel = await getOrCreateDirectChannel(actorId(auth.session), body.memberId);
  if (!channel) return NextResponse.json({ ok: false, error: 'לא ניתן לפתוח שיחה' }, { status: 400 });
  return NextResponse.json({ ok: true, data: channel }, { status: 201 });
}
