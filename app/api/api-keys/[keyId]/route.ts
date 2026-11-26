import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { revokeApiKey } from '@/lib/api-keys';
import { requireAdmin } from '@/lib/viewer';

type Params = { params: Promise<{ keyId: string }> };

/** Cancel a key. Whatever uses it is cut off on its very next request. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const { keyId } = await params;
  if (!(await revokeApiKey(keyId))) return NextResponse.json({ ok: false, error: 'המפתח לא נמצא או שכבר בוטל' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
