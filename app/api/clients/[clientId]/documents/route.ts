import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { clientVisibleTo, getClient, listClientDocuments, saveDocument } from '@/lib/store';
import { getViewer } from '@/lib/viewer';

type Params = { params: Promise<{ clientId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });
  const { clientId } = await params;
  const client = await getClient(clientId);
  if (!client || !await clientVisibleTo(client, auth.viewer)) {
    return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, data: await listClientDocuments(clientId) });
}

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });
  const { clientId } = await params;
  const client = await getClient(clientId);
  if (!client || !await clientVisibleTo(client, auth.viewer)) {
    return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Expected multipart form data' }, { status: 400 });
  }

  const files = form.getAll('file').filter((f): f is File => f instanceof File);
  if (!files.length) {
    return NextResponse.json({ ok: false, error: 'לא נבחר קובץ' }, { status: 400 });
  }

  const caseId = String(form.get('caseId') || '') || undefined;
  const checklistCode = String(form.get('checklistCode') || '') || undefined;
  // Per-file display names, appended in the same order as the files.
  const labels = form.getAll('label').map((value) => String(value));

  const saved = [];
  for (const [index, file] of files.entries()) {
    if (file.size > env.uploadMaxFileBytes) {
      return NextResponse.json(
        { ok: false, error: `הקובץ ${file.name} גדול מדי (מקסימום ${(env.uploadMaxFileBytes / 1024 / 1024).toFixed(0)}MB)` },
        { status: 413 },
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const record = await saveDocument({
      clientId,
      caseId,
      checklistCode,
      label: labels[index]?.trim() || undefined,
      originalName: file.name,
      mimeType: file.type,
      buffer,
    });
    if (record) saved.push(record);
  }

  return NextResponse.json({ ok: true, data: saved }, { status: 201 });
}
