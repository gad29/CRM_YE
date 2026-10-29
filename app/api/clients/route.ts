import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { countMissingItems, type CaseKind, type OperatingCompany, type GovernmentOffice } from '@/lib/domain';
import { caseVisibleTo, createCase, createClient, getCaseFinance, getConfig, listCases, listPayments, listVisibleClients } from '@/lib/store';
import { actorId, getViewer } from '@/lib/viewer';

export async function GET() {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });

  const clients = await listVisibleClients(auth.viewer);
  // Counts and balances only from the cases this person may see.
  const cases = (await listCases()).filter((c) => caseVisibleTo(c, auth.viewer));
  const payments = await listPayments();

  const enriched = clients.map((client) => {
    const clientCases = cases.filter((c) => c.clientId === client.id);
    const openCases = clientCases.filter((c) => c.stage !== 'closed');
    const missingItems = openCases.reduce((sum, c) => sum + countMissingItems(c), 0);
    const finance = clientCases.map((c) => getCaseFinance(c, payments));
    const balance = finance.reduce((sum, f) => sum + f.balance, 0);
    return {
      ...client,
      caseCount: clientCases.length,
      openCaseCount: openCases.length,
      missingItems,
      hasTrouble: openCases.some((c) => c.troubleFlag),
      outstandingBalance: balance,
    };
  });

  return NextResponse.json({ ok: true, data: enriched });
}

export async function POST(request: NextRequest) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });

  let body: {
    fullName?: string;
    phone?: string;
    idNumber?: string;
    email?: string;
    address?: string;
    city?: string;
    notes?: string;
    /** Creating a client opens a case (unless disabled in settings / by the flag). */
    createCase?: boolean;
    case?: {
      title?: string;
      company?: OperatingCompany;
      caseKind?: CaseKind;
      fee?: number;
      /** Exactly which documents to require (template codes) — overrides seedChecklist. */
      checklistCodes?: string[];
      /** Extra required documents, free text. */
      customChecklist?: string[];
      office?: string;
      /** Whether to pre-load the document checklist into the new case. */
      seedChecklist?: boolean;
    };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  if (!body.fullName?.trim() || !body.phone?.trim()) {
    return NextResponse.json({ ok: false, error: 'שם מלא וטלפון הם שדות חובה' }, { status: 400 });
  }

  const config = await getConfig();
  // Open a case unless the admin turned auto-create off (the flag can override).
  const shouldCreateCase = body.createCase ?? config.autoCreateCaseOnClient;
  // Checked before the client is saved, so a refused request leaves nothing half-made.
  if (shouldCreateCase && !config.companies.some((c) => c.value === body.case?.company)) {
    return NextResponse.json({ ok: false, error: 'יש לבחור חברה מטפלת לתיק' }, { status: 400 });
  }

  const creator = actorId(auth.session);
  const record = await createClient({
    fullName: body.fullName,
    phone: body.phone,
    idNumber: body.idNumber,
    email: body.email,
    address: body.address,
    city: body.city,
    notes: body.notes,
    createdBy: creator,
  });

  let caseRecord = undefined;
  if (shouldCreateCase) {
    const seed = body.case?.seedChecklist ?? config.seedChecklistByDefault;
    caseRecord = await createCase({
      clientId: record.id,
      title: body.case?.title?.trim() || config.defaultCaseTitle,
      office: (body.case?.office as GovernmentOffice | undefined) || 'housing-ministry',
      company: body.case?.company,
      caseKind: body.case?.caseKind || 'new',
      fee: body.case?.fee ?? config.defaultFee,
      openedBy: creator,
      checklistCodes: Array.isArray(body.case?.checklistCodes)
        ? body.case.checklistCodes.filter((c): c is string => typeof c === 'string')
        : seed
          ? config.documentTemplates.map((t) => t.code)
          : [],
      customChecklist: Array.isArray(body.case?.customChecklist)
        ? body.case.customChecklist.filter((c): c is string => typeof c === 'string').slice(0, 30)
        : [],
    });
  }

  return NextResponse.json({ ok: true, data: { client: record, case: caseRecord } }, { status: 201 });
}
