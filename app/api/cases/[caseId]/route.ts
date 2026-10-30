import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  caseHandlerId,
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
  getConfig,
  getSettings,
  listActivity,
  listCaseDocuments,
  listCasePayments,
  updateCase,
} from '@/lib/store';
import { cleanExtraInput, missingRequired, requiredError } from '@/lib/fields';
import { personDirectory } from '@/lib/users';
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
  const active = [...people.values()].filter((p) => p.active);
  return NextResponse.json({
    ok: true,
    data: {
      case: {
        ...caseRecord,
        officeName: officeDisplayName(caseRecord),
        missingItems: countMissingItems(caseRecord),
        finance: getCaseFinance(caseRecord, casePayments),
        assignedToName: nameOf(caseRecord.assignedTo),
        openedByName: nameOf(caseRecord.openedBy),
        handlerId,
        handlerName: nameOf(handlerId),
      },
      client,
      documents: await listCaseDocuments(caseId),
      payments: isAdmin ? casePayments : [],
      activity: await listActivity({ caseId, limit: 30 }),
      // Who a case can be transferred to: managers for everyone, workers for admins.
      managers: active.filter((p) => p.role === 'admin').map(({ id, name }) => ({ id, name })),
      workers: isAdmin ? active.filter((p) => p.role === 'worker').map(({ id, name }) => ({ id, name })) : [],
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
    /** Values of case fields added in Settings; an empty string clears one. */
    extra?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const config = await getConfig();
  if (body.stage && !config.stages.some((s) => s.code === body.stage)) {
    return NextResponse.json({ ok: false, error: 'השלב הזה כבר לא קיים — רעננו את הדף' }, { status: 400 });
  }
  if (body.company && !config.companies.some((c) => c.value === body.company)) {
    return NextResponse.json({ ok: false, error: 'החברה שנבחרה לא קיימת ברשימת החברות' }, { status: 400 });
  }
  const extra = cleanExtraInput(body.extra, config.caseFields);
  const plain = { ...body };
  delete plain.extra;
  const missing = missingRequired({ ...plain, ...extra } as Record<string, string | number | undefined>, config.caseFields, 'update');
  if (missing.length) return NextResponse.json({ ok: false, error: requiredError(missing) }, { status: 400 });

  // Transfers: an admin can hand a case to any active manager or worker; a
  // worker can hand a case they handle back to a manager (not to other workers).
  if (body.assignedTo !== undefined) {
    const target = String(body.assignedTo).trim();
    const person = target ? (await personDirectory()).get(target) : undefined;
    if (auth.viewer.role !== 'admin') {
      if (!person || !person.active || person.role !== 'admin') {
        return NextResponse.json({ ok: false, error: 'עובד יכול להעביר תיק רק למנהל' }, { status: 403 });
      }
    } else if (target && (!person || !person.active)) {
      return NextResponse.json({ ok: false, error: 'יעד ההעברה לא נמצא או שאינו פעיל' }, { status: 400 });
    }
    body.assignedTo = target;
  }

  const updated = await updateCase(caseId, { ...plain, extra });
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
