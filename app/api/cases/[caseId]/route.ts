import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  CASE_STAGES,
  caseHandlerId,
  countMissingItems,
  isManagerId,
  officeDisplayName,
  type CaseKind,
  type CaseStage,
  type DecisionStatus,
  type GovernmentOffice,
  type InvestigationOutcome,
  type OperatingCompany,
} from '@/lib/domain';
import {
  caseVisibleTo,
  deleteCase,
  getCase,
  getCaseFinance,
  getClient,
  getSettings,
  listActivity,
  listCaseDocuments,
  listCasePayments,
  personDirectory,
  updateCase,
} from '@/lib/store';
import { getViewer } from '@/lib/viewer';

type Params = { params: Promise<{ caseId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });

  const { caseId } = await params;
  const caseRecord = await getCase(caseId);
  if (!caseRecord || !caseVisibleTo(caseRecord, auth.viewer)) {
    return NextResponse.json({ ok: false, error: 'Case not found' }, { status: 404 });
  }

  const isAdmin = auth.viewer.role === 'admin';
  const people = await personDirectory();
  const client = await getClient(caseRecord.clientId);
  const casePayments = await listCasePayments(caseId);
  const nameOf = (id?: string) => (id ? people.get(id)?.name || '' : '');
  const handlerId = caseHandlerId(caseRecord);
  const active = [...people.values()].filter((p) => p.active).map(({ id, name }) => ({ id, name }));
  return NextResponse.json({
    ok: true,
    data: {
      case: {
        ...caseRecord,
        officeName: officeDisplayName(caseRecord),
        missingItems: countMissingItems(caseRecord),
        finance: getCaseFinance(caseRecord, casePayments),
        assignedToName: nameOf(caseRecord.assignedTo),
        openedByName: caseRecord.openedBy === 'admin' ? '' : nameOf(caseRecord.openedBy),
        handlerId,
        handlerName: nameOf(handlerId),
      },
      client,
      documents: await listCaseDocuments(caseId),
      payments: isAdmin ? casePayments : [],
      activity: await listActivity({ caseId, limit: 30 }),
      // Who a case can be transferred to: managers for everyone, workers for admins.
      managers: active.filter((p) => isManagerId(p.id)),
      workers: isAdmin ? active.filter((p) => !isManagerId(p.id)) : [],
      canManagePayments: isAdmin,
      canAssign: isAdmin,
      canTransferToManager: !isAdmin,
      hasBlankContract: Boolean((await getSettings()).blankContract),
    },
  });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });

  const { caseId } = await params;
  const existing = await getCase(caseId);
  if (!existing || !caseVisibleTo(existing, auth.viewer)) {
    return NextResponse.json({ ok: false, error: 'Case not found' }, { status: 404 });
  }

  let body: {
    title?: string;
    office?: GovernmentOffice;
    officeOther?: string;
    description?: string;
    stage?: CaseStage;
    fee?: number;
    referenceNumber?: string;
    nextAction?: string;
    notes?: string;
    decision?: string;
    company?: OperatingCompany;
    caseKind?: CaseKind;
    troubleFlag?: boolean;
    troubleNote?: string;
    decisionStatus?: DecisionStatus;
    investigationOutcome?: InvestigationOutcome | '';
    assignedTo?: string;
    paymentStatusOverride?: 'paid' | 'partial' | 'unpaid' | 'auto' | '';
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  if (body.stage && !CASE_STAGES.includes(body.stage)) {
    return NextResponse.json({ ok: false, error: `Unknown stage: ${body.stage}` }, { status: 400 });
  }

  // Transfers: an admin can hand a case to any active manager or worker; a
  // worker can hand a case they handle back to a manager (not to other workers).
  if (body.assignedTo !== undefined) {
    const target = String(body.assignedTo).trim();
    const person = target ? (await personDirectory()).get(target) : undefined;
    if (auth.viewer.role !== 'admin') {
      if (!person || !person.active || !isManagerId(target)) {
        return NextResponse.json({ ok: false, error: 'עובד יכול להעביר תיק רק למנהל' }, { status: 403 });
      }
    } else if (target && (!person || !person.active)) {
      return NextResponse.json({ ok: false, error: 'יעד ההעברה לא נמצא או שאינו פעיל' }, { status: 400 });
    }
    body.assignedTo = target;
  }

  const updated = await updateCase(caseId, body);
  if (!updated) return NextResponse.json({ ok: false, error: 'Case not found' }, { status: 404 });
  // After a transfer a worker may no longer have access — the page uses this to leave.
  return NextResponse.json({ ok: true, data: updated, stillVisible: caseVisibleTo(updated, auth.viewer) });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });
  if (auth.viewer.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'רק מנהל יכול למחוק תיק' }, { status: 403 });
  }
  const { caseId } = await params;
  const deleted = await deleteCase(caseId);
  if (!deleted) return NextResponse.json({ ok: false, error: 'Case not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
