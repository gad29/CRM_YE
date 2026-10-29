import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '@/lib/domain';
import { createPayment, getConfig, listPayments } from '@/lib/store';
import { requireAdmin } from '@/lib/viewer';

export async function GET() {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  return NextResponse.json({ ok: true, data: await listPayments() });
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  let body: { clientId?: string; caseId?: string; amount?: number; method?: PaymentMethod; paidAt?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  if (!body.clientId || !body.amount || body.amount <= 0) {
    return NextResponse.json({ ok: false, error: 'לקוח וסכום חיובי הם שדות חובה' }, { status: 400 });
  }
  // Built-in methods plus any added in Settings.
  const known = new Set([...Object.keys(PAYMENT_METHOD_LABELS), ...(await getConfig()).paymentMethods.map((m) => m.value)]);
  const method = (body.method && known.has(body.method) ? body.method : 'other') as PaymentMethod;

  const record = await createPayment({
    clientId: body.clientId,
    caseId: body.caseId,
    amount: body.amount,
    method,
    paidAt: body.paidAt,
    note: body.note,
  });
  if (!record) return NextResponse.json({ ok: false, error: 'Client not found or invalid amount' }, { status: 400 });
  return NextResponse.json({ ok: true, data: record }, { status: 201 });
}
