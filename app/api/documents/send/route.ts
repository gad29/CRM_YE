import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { documentVisibleTo, getDocument, sendDocumentsLink, type SendChannel } from '@/lib/store';
import { getViewer } from '@/lib/viewer';

/** Send one or several documents to their client as a single secure link (email via Resend, WhatsApp via Meta). */
export async function POST(request: NextRequest) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });


  let body: { documentIds?: string[]; channel?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const ids = Array.isArray(body.documentIds) ? body.documentIds.filter((x) => typeof x === 'string') : [];
  if (!ids.length) return NextResponse.json({ ok: false, error: 'לא נבחרו מסמכים' }, { status: 400 });
  if (ids.length > 50) return NextResponse.json({ ok: false, error: 'ניתן לשלוח עד 50 מסמכים בקישור אחד' }, { status: 400 });

  const channel = body.channel;
  if (channel !== 'email' && channel !== 'whatsapp') {
    return NextResponse.json({ ok: false, error: 'ערוץ שליחה לא תקין' }, { status: 400 });
  }

  // Every selected document must exist and be visible to the caller.
  for (const id of ids) {
    const doc = await getDocument(id);
    if (!doc || !await documentVisibleTo(doc, auth.viewer)) {
      return NextResponse.json({ ok: false, error: 'אחד המסמכים לא נמצא' }, { status: 404 });
    }
  }

  const result = await sendDocumentsLink(ids, channel as SendChannel);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
