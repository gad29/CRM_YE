import { NextResponse } from 'next/server';
import { fileResponse } from '@/lib/file-response';
import { readBlankContract } from '@/lib/store';
import { requireViewer } from '@/lib/viewer';

/** Download the blank rent-contract template — available to any signed-in user (workers included). */
export async function GET() {
  const guard = await requireViewer();
  if (guard instanceof NextResponse) return guard;
  const template = await readBlankContract();
  if (!template) {
    return NextResponse.json({ ok: false, error: 'לא הועלה טופס חוזה שכירות ריק' }, { status: 404 });
  }
  return fileResponse(template.buffer, { mimeType: template.meta.mimeType, fileName: template.meta.originalName, download: true });
}
