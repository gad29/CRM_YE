import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  caseHandlerId,
  countMissingItems,
  officeDisplayName,
  type CaseKind,
  type GovernmentOffice,
  type OperatingCompany,
} from '@/lib/domain';
import { createCase, getCaseFinance, getConfig, listClients, listPayments, listVisibleCases, personDirectory } from '@/lib/store';
import { actorId, getViewer } from '@/lib/viewer';

export async function GET() {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });

  const cases = await listVisibleCases(auth.viewer);
  const clients = await listClients();
  const payments = await listPayments();
  const people = await personDirectory();
  const nameOf = (id?: string) => (id ? people.get(id)?.name || '' : '');

  const enriched = cases.map((caseRecord) => {
    const client = clients.find((c) => c.id === caseRecord.clientId);
    return {
      ...caseRecord,
      clientName: client?.fullName || '',
      clientPhone: client?.phone || '',
      officeName: officeDisplayName(caseRecord),
      missingItems: countMissingItems(caseRecord),
      finance: getCaseFinance(caseRecord, payments),
      openedByName: caseRecord.openedBy === 'admin' ? '' : nameOf(caseRecord.openedBy),
      assignedToName: nameOf(caseRecord.assignedTo),
      handlerId: caseHandlerId(caseRecord),
    };
  });

  return NextResponse.json({ ok: true, data: enriched });
}

export async function POST(request: NextRequest) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });

  let body: {
    clientId?: string;
    title?: string;
    office?: GovernmentOffice;
    officeOther?: string;
    description?: string;
    fee?: number;
    nextAction?: string;
    company?: OperatingCompany;
    caseKind?: CaseKind;
    checklistCodes?: string[];
    customChecklist?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  if (!body.clientId || !body.title?.trim()) {
    return NextResponse.json({ ok: false, error: 'לקוח וכותרת תיק הם שדות חובה' }, { status: 400 });
  }
  if (!(await getConfig()).companies.some((c) => c.value === body.company)) {
    return NextResponse.json({ ok: false, error: 'יש לבחור חברה מטפלת לתיק' }, { status: 400 });
  }

  const record = await createCase({
    clientId: body.clientId,
    title: body.title,
    office: body.office || 'housing-ministry',
    officeOther: body.officeOther,
    description: body.description,
    fee: body.fee,
    nextAction: body.nextAction,
    company: body.company,
    caseKind: body.caseKind,
    openedBy: actorId(auth.session),
    checklistCodes: body.checklistCodes,
    customChecklist: body.customChecklist,
  });
  if (!record) return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
  return NextResponse.json({ ok: true, data: record }, { status: 201 });
}
