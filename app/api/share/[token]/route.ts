import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getConfig, getDocument, getDocuments, readDocumentFile } from '@/lib/store';
import { parseShareToken } from '@/lib/share';
import { fileResponse } from '@/lib/file-response';
import type { DocumentRecord } from '@/lib/domain';

function streamDocument(record: DocumentRecord, download = false) {
  const file = readDocumentFile(record);
  if (!file) return NextResponse.json({ ok: false, error: 'הקובץ חסר' }, { status: 404 });
  const response = fileResponse(file, { mimeType: record.mimeType, fileName: record.originalName, download });
  // The token is in the URL — never leak it through a Referer header.
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function fileEmoji(mimeType: string, name: string) {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return '📄';
  if (mimeType.includes('word') || /\.(docx?|rtf)$/i.test(name)) return '📝';
  if (mimeType.includes('sheet') || /\.(xlsx?|csv)$/i.test(name)) return '📊';
  return '📎';
}

/** Renders a minimal, self-contained RTL page listing the shared documents. */
function bundlePage(token: string, docs: DocumentRecord[], businessName: string) {
  const rows = docs
    .map((d) => {
      const name = escapeHtml(d.label || d.originalName);
      const href = `/api/share/${encodeURIComponent(token)}?doc=${encodeURIComponent(d.id)}`;
      const dl = `${href}&download=1`;
      return `<li class="row">
        <span class="emoji">${fileEmoji(d.mimeType, d.originalName)}</span>
        <span class="name">${name}</span>
        <span class="actions">
          <a href="${href}" target="_blank" rel="noreferrer">צפייה</a>
          <a href="${dl}">הורדה</a>
        </span>
      </li>`;
    })
    .join('');

  const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>מסמכים מ${escapeHtml(businessName)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #f1f5f9; color: #0f172a;
    font-family: 'Segoe UI', system-ui, Arial, sans-serif; padding: 20px; }
  @media (prefers-color-scheme: dark) { body { background: #0b1220; color: #e2e8f0; } .card { background: #131c2e !important; border-color: rgba(148,163,184,.16) !important; } .row { border-color: rgba(148,163,184,.16) !important; } a { color: #60a5fa !important; } }
  .card { background: #fff; border: 1px solid #e4ecfc; border-radius: 18px; padding: 26px 28px; max-width: 520px; width: 100%; box-shadow: 0 8px 30px rgba(15,23,42,.08); }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #64748b; font-size: 13px; margin: 0 0 18px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid #e4ecfc; border-radius: 12px; }
  .emoji { font-size: 20px; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: 14px; }
  .actions { display: flex; gap: 10px; flex-shrink: 0; }
  a { color: #2563eb; text-decoration: none; font-weight: 600; font-size: 13px; }
  a:hover { text-decoration: underline; }
  .foot { color: #94a3b8; font-size: 12px; margin-top: 16px; text-align: center; }
</style>
</head>
<body>
  <div class="card">
    <h1>מסמכים עבורך</h1>
    <p class="sub">${docs.length} מסמכים · נשלח מ${escapeHtml(businessName)}</p>
    <ul>${rows}</ul>
    <p class="foot">קישור מאובטח ואישי — נא לא להעביר לאחרים.</p>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      // Static page: inline styles only, no script, nothing external.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/**
 * Public, login-free access to shared documents via a signed, expiring token.
 * - ?doc=<id> streams that one file (id must be authorized by the token).
 * - single-document token streams the file directly.
 * - multi-document token renders a page listing all authorized documents.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = parseShareToken(token);
  if (!parsed) {
    return NextResponse.json({ ok: false, error: 'הקישור אינו תקין או שפג תוקפו' }, { status: 404 });
  }

  const requestedId = request.nextUrl.searchParams.get('doc');
  if (requestedId) {
    if (!parsed.documentIds.includes(requestedId)) {
      return NextResponse.json({ ok: false, error: 'הקישור אינו מתיר גישה למסמך זה' }, { status: 403 });
    }
    const record = await getDocument(requestedId);
    if (!record) return NextResponse.json({ ok: false, error: 'המסמך לא נמצא' }, { status: 404 });
    return streamDocument(record, request.nextUrl.searchParams.get('download') === '1');
  }

  // Keep the order the documents were shared in.
  const found = await getDocuments(parsed.documentIds);
  const docs = parsed.documentIds
    .map((id) => found.find((d) => d.id === id))
    .filter((d): d is DocumentRecord => Boolean(d));
  if (!docs.length) return NextResponse.json({ ok: false, error: 'המסמכים לא נמצאו' }, { status: 404 });

  // A single document opens directly; multiple render the bundle page.
  if (docs.length === 1) return streamDocument(docs[0]);
  return bundlePage(token, docs, (await getConfig()).businessName);
}
