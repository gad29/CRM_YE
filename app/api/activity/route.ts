import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { requireAdmin } from '@/lib/viewer';

/**
 * Admin audit log: everything that happened, newest first.
 *   ?q=text      search in the description
 *   ?kind=…      one area: cases, clients, documents, payments, tasks, team, settings
 *   ?before=ISO  page back in time
 */
const KINDS: Record<string, string[]> = {
  cases: ['case-%', 'checklist-%'],
  clients: ['client-%'],
  documents: ['document-%'],
  payments: ['payment-%'],
  tasks: ['task-%'],
  team: ['user-%', 'login-%', 'password-%'],
  settings: ['config-%', 'settings-%'],
};

export async function GET(request: NextRequest) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  const q = (request.nextUrl.searchParams.get('q') || '').trim().slice(0, 100);
  const before = request.nextUrl.searchParams.get('before');
  const params: unknown[] = [];
  const where: string[] = [];
  if (q) {
    params.push(`%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    where.push(`a.summary ILIKE $${params.length}`);
  }
  const kind = KINDS[request.nextUrl.searchParams.get('kind') || ''];
  if (kind) {
    params.push(kind);
    where.push(`a.type LIKE ANY($${params.length}::text[])`);
  }
  if (before && !Number.isNaN(Date.parse(before))) {
    params.push(before);
    where.push(`a.at < $${params.length}`);
  }
  const rows = await sql(
    `SELECT a.*, c.full_name AS client_name
       FROM activity a LEFT JOIN clients c ON c.id = a.client_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.at DESC, a.id DESC LIMIT 80`,
    params,
  );
  return NextResponse.json({
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      type: r.type,
      summary: r.summary,
      at: new Date(r.at).toISOString(),
      clientId: r.client_id ?? undefined,
      clientName: r.client_name ?? undefined,
      caseId: r.case_id ?? undefined,
    })),
  });
}
