import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { documentVisibleTo, getDocument, saveDocument } from '@/lib/store';
import { getViewer } from '@/lib/viewer';

type Params = { params: Promise<{ documentId: string }> };

/**
 * Saves an edited version of an existing document as a new document record
 * (the original file is kept untouched). Expects multipart form data with `file`.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });
  const { documentId } = await params;
  const source = await getDocument(documentId);
  if (!source || !await documentVisibleTo(source, auth.viewer)) {
    return NextResponse.json({ ok: false, error: 'Document not found' }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Expected multipart form data' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'Missing file' }, { status: 400 });
  }
  if (file.size > env.uploadMaxFileBytes) {
    return NextResponse.json({ ok: false, error: 'הקובץ הערוך גדול מדי' }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const label = String(form.get('label') || '') || `${source.label || source.originalName} (ערוך)`;

  const record = await saveDocument({
    clientId: source.clientId,
    caseId: source.caseId,
    originalName: file.name || source.originalName,
    mimeType: file.type || source.mimeType,
    buffer,
    label,
    editedFromId: source.id,
  });
  if (!record) return NextResponse.json({ ok: false, error: 'Save failed' }, { status: 500 });
  return NextResponse.json({ ok: true, data: record }, { status: 201 });
}
