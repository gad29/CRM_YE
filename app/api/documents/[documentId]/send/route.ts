import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { documentVisibleTo, getDocument, sendDocumentLink, type SendChannel } from '@/lib/store';
import { getViewer } from '@/lib/viewer';

/** Send a document to its client as a secure link by email (Resend) or WhatsApp (Meta). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });

  const { documentId } = await params;
  const doc = await getDocument(documentId);
  if (!doc || !await documentVisibleTo(doc, auth.viewer)) {
    return NextResponse.json({ ok: false, error: 'Document not found' }, { status: 404 });
  }


  let body: { channel?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const channel = body.channel;
  if (channel !== 'email' && channel !== 'whatsapp') {
    return NextResponse.json({ ok: false, error: 'ערוץ שליחה לא תקין' }, { status: 400 });
  }

  const result = await sendDocumentLink(documentId, channel as SendChannel);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
