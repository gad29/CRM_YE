import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  CASE_STAGES,
  countMissingItems,
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
  listWorkers,
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
  const workers = (await listWorkers()).map(({ passwordHash: _hash, ...worker }) => worker);
  const client = await getClient(caseRecord.clientId);
  const casePayments = await listCasePayments(caseId);
  const workerName = (id?: string) => (id && id !== 'admin' ? workers.find((w) => w.id === id)?.name || '' : '');
  return NextResponse.json({
    ok: true,
    data: {
      case: {
        ...caseRecord,
        officeName: officeDisplayName(caseRecord),
        missingItems: countMissingItems(caseRecord),
        finance: getCaseFinance(caseRecord, casePayments),
        assignedToName: workerName(caseRecord.assignedTo),
        openedByName: workerName(caseRecord.openedBy),
      },
      client,
      documents: await listCaseDocuments(caseId),
      payments: isAdmin ? casePayments : [],
      activity: await listActivity({ caseId, limit: 30 }),
      workers: isAdmin ? workers.filter((w) => w.active) : [],
      canManagePayments: isAdmin,
      canAssign: isAdmin,
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

  // Only the admin can assign cases to workers.
  if (body.assignedTo !== undefined && auth.viewer.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'רק מנהל יכול לשייך תיקים לעובדים' }, { status: 403 });
  }

  const updated = await updateCase(caseId, body);
  if (!updated) return NextResponse.json({ ok: false, error: 'Case not found' }, { status: 404 });
  return NextResponse.json({ ok: true, data: updated });
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
