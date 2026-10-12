import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { ChecklistStatus } from '@/lib/domain';
import {
  addChecklistItem,
  caseVisibleTo,
  clearChecklist,
  getCase,
  removeChecklistItems,
  updateChecklistItem,
} from '@/lib/store';
import { getViewer } from '@/lib/viewer';

type Params = { params: Promise<{ caseId: string }> };

async function guardCase(caseId: string) {
  const auth = await getViewer();
  if (!auth) return false;
  const caseRecord = await getCase(caseId);
  return Boolean(caseRecord && caseVisibleTo(caseRecord, auth.viewer));
}

export async function POST(request: NextRequest, { params }: Params) {
  const { caseId } = await params;
  if (!(await guardCase(caseId))) return NextResponse.json({ ok: false, error: 'Case not found' }, { status: 404 });

  let body: { label?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const item = await addChecklistItem(caseId, body.label || '', body.code);
  if (!item) return NextResponse.json({ ok: false, error: 'הוספת פריט נכשלה (אולי כבר קיים)' }, { status: 400 });
  return NextResponse.json({ ok: true, data: item }, { status: 201 });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { caseId } = await params;
  if (!(await guardCase(caseId))) return NextResponse.json({ ok: false, error: 'Case not found' }, { status: 404 });
  let body: { code?: string; status?: ChecklistStatus; note?: string; label?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  if (!body.code) return NextResponse.json({ ok: false, error: 'Missing checklist item code' }, { status: 400 });
  const item = await updateChecklistItem(caseId, body.code, { status: body.status, note: body.note, label: body.label });
  if (!item) return NextResponse.json({ ok: false, error: 'Checklist item not found' }, { status: 404 });
  return NextResponse.json({ ok: true, data: item });
}

/**
 * Delete checklist items. Supports:
 *   ?code=X              single item
 *   ?codes=X,Y,Z         several items at once
 *   ?clear=1             the whole checklist
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { caseId } = await params;
  if (!(await guardCase(caseId))) return NextResponse.json({ ok: false, error: 'Case not found' }, { status: 404 });

  const params_ = request.nextUrl.searchParams;
  if (params_.get('clear') === '1') {
    const removed = await clearChecklist(caseId);
    return NextResponse.json({ ok: true, removed });
  }

  const codes = [
    ...(params_.get('code') ? [params_.get('code') as string] : []),
    ...(params_.get('codes') ? (params_.get('codes') as string).split(',').filter(Boolean) : []),
  ];
  if (!codes.length) return NextResponse.json({ ok: false, error: 'Missing checklist item code(s)' }, { status: 400 });

  const removed = await removeChecklistItems(caseId, codes);
  if (!removed) return NextResponse.json({ ok: false, error: 'No matching checklist items' }, { status: 404 });
  return NextResponse.json({ ok: true, removed });
}
