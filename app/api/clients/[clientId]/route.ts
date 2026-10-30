import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { caseHandlerId, countMissingItems } from '@/lib/domain';
import {
  caseVisibleTo,
  clientVisibleTo,
  deleteClient,
  getCaseFinance,
  getClient,
  getConfig,
  listActivity,
  listClientCases,
  listClientDocuments,
  listClientPayments,
  listPayments,
  updateClient,
} from '@/lib/store';
import { cleanExtraInput, missingRequired, requiredError } from '@/lib/fields';
import { personDirectory } from '@/lib/users';
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
      openedByName: nameOf(c.openedBy),
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

  let body: Record<string, string> & { extra?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  if (body.fullName !== undefined && !String(body.fullName).trim()) {
    return NextResponse.json({ ok: false, error: 'שם מלא הוא שדה חובה' }, { status: 400 });
  }
  const config = await getConfig();
  const extra = cleanExtraInput(body.extra, config.clientFields);
  const details: Record<string, string> = {};
  for (const key of ['phone', 'idNumber', 'email', 'address', 'city', 'notes']) if (key in body) details[key] = body[key];
  const missing = missingRequired({ ...details, ...extra }, config.clientFields, 'update');
  if (missing.length) return NextResponse.json({ ok: false, error: requiredError(missing) }, { status: 400 });

  const updated = await updateClient(clientId, {
    fullName: body.fullName,
    phone: body.phone,
    idNumber: body.idNumber,
    email: body.email,
    address: body.address,
    city: body.city,
    notes: body.notes,
    extra,
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
