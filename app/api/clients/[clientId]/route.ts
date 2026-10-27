import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { caseHandlerId, countMissingItems } from '@/lib/domain';
import {
  caseVisibleTo,
  clientVisibleTo,
  deleteClient,
  getCaseFinance,
  getClient,
  listActivity,
  listClientCases,
  listClientDocuments,
  listClientPayments,
  listPayments,
  personDirectory,
  updateClient,
} from '@/lib/store';
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

  const payments = await listPayments();
  const people = await personDirectory();
  const nameOf = (id?: string) => (id ? people.get(id)?.name || '' : '');
  const cases = (await listClientCases(clientId))
    .filter((c) => caseVisibleTo(c, auth.viewer))
    .map((c) => ({
      ...c,
      missingItems: countMissingItems(c),
      finance: getCaseFinance(c, payments),
      assignedToName: nameOf(c.assignedTo),
      openedByName: c.openedBy === 'admin' ? '' : nameOf(c.openedBy),
      handlerId: caseHandlerId(c),
    }));

  const isAdmin = auth.viewer.role === 'admin';
  return NextResponse.json({
    ok: true,
    data: {
      client,
      cases,
      documents: await listClientDocuments(clientId),
      payments: isAdmin ? await listClientPayments(clientId) : [],
      activity: await listActivity({ clientId, limit: 30 }),
      canManagePayments: isAdmin,
    },
  });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });

  const { clientId } = await params;
  const client = await getClient(clientId);
  if (!client || !await clientVisibleTo(client, auth.viewer)) {
    return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
  }

  let body: Record<string, string>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const updated = await updateClient(clientId, {
    fullName: body.fullName,
    phone: body.phone,
    idNumber: body.idNumber,
    email: body.email,
    address: body.address,
    city: body.city,
    notes: body.notes,
  });
  if (!updated) return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
  return NextResponse.json({ ok: true, data: updated });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });
  if (auth.viewer.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'רק מנהל יכול למחוק לקוח' }, { status: 403 });
  }
  const { clientId } = await params;
  const deleted = await deleteClient(clientId);
  if (!deleted) return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
