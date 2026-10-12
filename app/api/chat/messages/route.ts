import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { ReminderChannel } from '@/lib/domain';
import {
  getOrCreateDirectChannel,
  listChannelMessages,
  markChannelRead,
  postChatMessage,
  resolveChannelForMember,
} from '@/lib/chat';
import { env } from '@/lib/env';
import { actorId, getViewer } from '@/lib/viewer';

/** Messages of a channel. `after=<messageId>` returns only newer ones (polling). */
export async function GET(request: NextRequest) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });

  const me = actorId(auth.session);
  const channelId = request.nextUrl.searchParams.get('channelId');
  if (!channelId) return NextResponse.json({ ok: false, error: 'חסר מזהה שיחה' }, { status: 400 });

  const channel = await resolveChannelForMember(channelId, me);
  if (!channel) {
    return NextResponse.json({ ok: false, error: 'השיחה לא נמצאה' }, { status: 404 });
  }

  const after = request.nextUrl.searchParams.get('after') || undefined;
  const messages = await listChannelMessages(channelId, { afterId: after });

  // Opening/polling a conversation marks it read.
  if (request.nextUrl.searchParams.get('markRead') !== '0') await markChannelRead(channelId, me);

  return NextResponse.json({ ok: true, data: { channel, messages, me } });
}

/**
 * Post a message. Accepts JSON (text only) or multipart form data with
 * `file` entries — including a voice note (`voiceDuration` in seconds).
 */
export async function POST(request: NextRequest) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });
  const me = actorId(auth.session);

  let channelId = '';
  let body: string | undefined;
  let notify = false;
  let reminderAt: string | undefined;
  let reminderChannels: ReminderChannel[] = [];
  const files: { originalName: string; mimeType: string; buffer: Buffer; kind?: 'voice'; durationSec?: number }[] = [];

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ ok: false, error: 'Expected multipart form data' }, { status: 400 });
    }
    channelId = String(form.get('channelId') || '');
    body = String(form.get('body') || '') || undefined;
    notify = String(form.get('notify') || '') === '1';
    reminderAt = String(form.get('reminderAt') || '') || undefined;
    reminderChannels = String(form.get('reminderChannels') || '')
      .split(',')
      .filter((c): c is ReminderChannel => c === 'email' || c === 'whatsapp');

    const voiceDuration = Number(form.get('voiceDuration') || 0);
    for (const entry of form.getAll('file')) {
      if (!(entry instanceof File)) continue;
      if (entry.size > env.uploadMaxFileBytes) {
        return NextResponse.json({ ok: false, error: `הקובץ ${entry.name} גדול מדי` }, { status: 413 });
      }
      const isVoice = String(form.get('voice') || '') === '1';
      files.push({
        originalName: entry.name,
        mimeType: entry.type,
        buffer: Buffer.from(await entry.arrayBuffer()),
        kind: isVoice ? 'voice' : undefined,
        durationSec: isVoice && Number.isFinite(voiceDuration) ? Math.round(voiceDuration) : undefined,
      });
    }
  } else {
    let json: {
      channelId?: string;
      memberId?: string;
      body?: string;
      notify?: boolean;
      reminderAt?: string;
      reminderChannels?: ReminderChannel[];
    };
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
    }
    // Allow addressing a person directly; the DM channel is created on demand.
    if (!json.channelId && json.memberId) {
      const channel = await getOrCreateDirectChannel(me, json.memberId);
      if (!channel) return NextResponse.json({ ok: false, error: 'לא ניתן לפתוח שיחה' }, { status: 400 });
      channelId = channel.id;
    } else {
      channelId = json.channelId || '';
    }
    body = json.body;
    notify = Boolean(json.notify);
    reminderAt = json.reminderAt;
    reminderChannels = (json.reminderChannels ?? []).filter(
      (c): c is ReminderChannel => c === 'email' || c === 'whatsapp',
    );
  }

  if (!channelId) return NextResponse.json({ ok: false, error: 'חסר מזהה שיחה' }, { status: 400 });

  // Creates the direct conversation the first time someone writes in it.
  const channel = await resolveChannelForMember(channelId, me);
  if (!channel) {
    return NextResponse.json({ ok: false, error: 'השיחה לא נמצאה' }, { status: 404 });
  }

  const message = await postChatMessage({
    channelId,
    authorId: me,
    body,
    files,
    notify,
    reminder: reminderAt ? { at: reminderAt, channels: reminderChannels } : undefined,
  });
  if (!message) return NextResponse.json({ ok: false, error: 'שליחת ההודעה נכשלה' }, { status: 400 });
  return NextResponse.json({ ok: true, data: message }, { status: 201 });
}
