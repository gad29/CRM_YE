import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '@/lib/domain';
import { deletePayment, getConfig, updatePayment } from '@/lib/store';
import { requireAdmin } from '@/lib/viewer';

type Params = { params: Promise<{ paymentId: string }> };

/** Admin-only: fix a wrongly-recorded payment. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  const { paymentId } = await params;
  let body: { amount?: number; method?: PaymentMethod; paidAt?: string; note?: string; caseId?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  if (body.amount !== undefined && (!Number.isFinite(body.amount) || body.amount <= 0)) {
    return NextResponse.json({ ok: false, error: 'סכום חייב להיות חיובי (למחיקת תשלום השתמש בכפתור המחיקה)' }, { status: 400 });
  }
  if (body.method && !(body.method in PAYMENT_METHOD_LABELS) && !(await getConfig()).paymentMethods.some((m) => m.value === body.method)) {
    return NextResponse.json({ ok: false, error: 'אמצעי תשלום לא מוכר' }, { status: 400 });
  }

  const updated = await updatePayment(paymentId, body);
  if (!updated) return NextResponse.json({ ok: false, error: 'Payment not found' }, { status: 404 });
  return NextResponse.json({ ok: true, data: updated });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  const { paymentId } = await params;
  const deleted = await deletePayment(paymentId);
  if (!deleted) return NextResponse.json({ ok: false, error: 'Payment not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
