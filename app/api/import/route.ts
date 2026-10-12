import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  CASE_STAGES,
  COMPANY_LABELS,
  DEFAULT_CHECKLIST_CODES,
  STAGE_LABELS,
  type CaseKind,
  type CaseStage,
  type OperatingCompany,
} from '@/lib/domain';
import { createCase, createClient, createPayment, updateCase } from '@/lib/store';
import { requireAdmin } from '@/lib/viewer';

export interface ImportRow {
  fullName: string;
  phone: string;
  idNumber?: string;
  email?: string;
  city?: string;
  address?: string;
  notes?: string;
  caseTitle?: string;
  company?: string;
  caseKind?: string;
  stage?: string;
  fee?: number;
  paid?: number;
  trouble?: boolean;
}

function resolveCompany(raw?: string): OperatingCompany | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  for (const [key, label] of Object.entries(COMPANY_LABELS)) {
    if (value === key || value === label) return key as OperatingCompany;
  }
  return value ? 'none' : undefined;
}

function resolveKind(raw?: string): CaseKind {
  const value = (raw || '').trim();
  if (value === 'renewal' || value.includes('חידוש')) return 'renewal';
  return 'new';
}

function resolveStage(raw?: string): CaseStage {
  const value = (raw || '').trim();
  if (!value) return 'collecting-documents';
  if (CASE_STAGES.includes(value as CaseStage)) return value as CaseStage;
  for (const [stage, label] of Object.entries(STAGE_LABELS)) {
    if (value === label) return stage as CaseStage;
  }
  if (value.includes('סגור') || value.includes('הסתיים')) return 'closed';
  if (value.includes('ממתין לתשלום') || value.includes('אושר')) return 'awaiting-payment';
  if (value.includes('הוגש')) return 'submitted';
  if (value.includes('חסר') || value.includes('השלמ')) return 'action-required';
  return 'collecting-documents';
}

/** Admin-only. Bulk-imports old clients + their cases. */
export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  let body: { rows?: ImportRow[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return NextResponse.json({ ok: false, error: 'אין שורות לייבוא' }, { status: 400 });
  if (rows.length > 500) return NextResponse.json({ ok: false, error: 'עד 500 שורות בייבוא אחד' }, { status: 400 });

  let clientsCreated = 0;
  let casesCreated = 0;
  let paymentsCreated = 0;
  const errors: string[] = [];

  for (const [index, row] of rows.entries()) {
    const fullName = (row.fullName || '').trim();
    const phone = (row.phone || '').trim();
    if (!fullName) {
      errors.push(`שורה ${index + 1}: חסר שם`);
      continue;
    }

    const client = await createClient({
      fullName,
      phone: phone || '—',
      idNumber: row.idNumber,
      email: row.email,
      city: row.city,
      address: row.address,
      notes: row.notes,
      createdBy: 'admin',
    });
    clientsCreated += 1;

    const caseRecord = await createCase({
      clientId: client.id,
      title: (row.caseTitle || '').trim() || 'סיוע בשכר דירה',
      office: 'housing-ministry',
      company: resolveCompany(row.company),
      caseKind: resolveKind(row.caseKind),
      fee: Number.isFinite(row.fee) ? Number(row.fee) : 0,
      openedBy: 'admin',
      checklistCodes: DEFAULT_CHECKLIST_CODES,
    });
    if (!caseRecord) {
      errors.push(`שורה ${index + 1}: יצירת התיק נכשלה`);
      continue;
    }
    casesCreated += 1;

    const stage = resolveStage(row.stage);
    if (stage !== caseRecord.stage || row.trouble) {
      await updateCase(caseRecord.id, { stage, troubleFlag: Boolean(row.trouble) });
    }

    if (Number.isFinite(row.paid) && Number(row.paid) > 0) {
      const payment = await createPayment({
        clientId: client.id,
        caseId: caseRecord.id,
        amount: Number(row.paid),
        method: 'other',
        note: 'ייבוא נתונים ישנים',
      });
      if (payment) paymentsCreated += 1;
    }
  }

  return NextResponse.json({ ok: true, data: { clientsCreated, casesCreated, paymentsCreated, errors } });
}
