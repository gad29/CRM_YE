import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { caseVisibleTo, clientVisibleTo, getClient, listClientCases, listClientDocuments } from '@/lib/store';
import { requireViewer } from '@/lib/viewer';
import { zipDocuments, zipHeaders } from '@/lib/zip-documents';

type Params = { params: Promise<{ clientId: string }> };

/** Refuse absurd archives — they are built in memory. */
const MAX_TOTAL_BYTES = 400 * 1024 * 1024;

/**
 * Download a client's documents as one ZIP.
 *   ?ids=DOC-1,DOC-2   only these (must belong to the client)
 *   ?caseId=CASE-1     only that case's documents
 *   (neither)          everything, one folder per case
 */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireViewer();
  if (auth instanceof NextResponse) return auth;

  const { clientId } = await params;
  const client = await getClient(clientId);
  if (!client || !(await clientVisibleTo(client, auth.viewer))) {
    return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
  }

  const search = request.nextUrl.searchParams;
  const ids = (search.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const caseId = search.get('caseId') || '';

  const cases = (await listClientCases(clientId)).filter((c) => caseVisibleTo(c, auth.viewer));
  let docs = await listClientDocuments(clientId);
  if (caseId) {
    if (!cases.some((c) => c.id === caseId)) return NextResponse.json({ ok: false, error: 'Case not found' }, { status: 404 });
    docs = docs.filter((d) => d.caseId === caseId);
  }
  if (ids.length) {
    const wanted = new Set(ids);
    docs = docs.filter((d) => wanted.has(d.id));
  }
  if (!docs.length) return NextResponse.json({ ok: false, error: 'אין מסמכים להורדה' }, { status: 404 });

  const total = docs.reduce((sum, d) => sum + d.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    return NextResponse.json({ ok: false, error: 'הקבצים גדולים מדי לקובץ ZIP אחד — בחרו פחות מסמכים' }, { status: 413 });
  }

  // "Everything" gets one folder per case so the archive mirrors the CRM.
  const caseFolder = new Map(cases.map((c) => [c.id, `${c.title} (${c.id})`]));
  const byFolder = !ids.length && !caseId;
  const { buffer } = zipDocuments(docs, byFolder ? (d) => (d.caseId && caseFolder.get(d.caseId)) || 'כללי' : undefined);

  const caseTitle = caseId ? cases.find((c) => c.id === caseId)?.title : undefined;
  const name = `${client.fullName} - ${caseTitle ? `${caseTitle} - ` : ''}מסמכים`;
  return new NextResponse(new Uint8Array(buffer), { headers: zipHeaders(name, buffer.length) });
}
