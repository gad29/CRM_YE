import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { deleteBlankContract, getSettings, saveBlankContract } from '@/lib/store';
import { requireAdmin } from '@/lib/viewer';

/** Admin-only. Workers download via /api/templates/blank-contract. */

export async function GET() {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  const settings = await getSettings();
  return NextResponse.json({ ok: true, data: settings.blankContract || null });
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Expected multipart form data' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'לא נבחר קובץ' }, { status: 400 });
  }
  if (file.size > env.uploadMaxFileBytes) {
    return NextResponse.json({ ok: false, error: 'הקובץ גדול מדי' }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const meta = await saveBlankContract({ originalName: file.name, mimeType: file.type, buffer });
  return NextResponse.json({ ok: true, data: meta }, { status: 201 });
}

export async function DELETE() {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  const deleted = await deleteBlankContract();
  if (!deleted) return NextResponse.json({ ok: false, error: 'No blank contract uploaded' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
