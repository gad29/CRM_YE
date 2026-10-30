import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { DEFAULT_CASE_FIELDS, DEFAULT_CLIENT_FIELDS, type AppConfig } from '@/lib/domain';
import { getConfig, normalizeFields, normalizeStages, saveConfig, StageInUseError } from '@/lib/store';
import { TEXT_DEFAULTS } from '@/lib/texts';
import { getViewer } from '@/lib/viewer';

/** Any signed-in user reads config (labels are needed everywhere). */
export async function GET() {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, data: await getConfig() });
}

/** Only the admin edits settings. */
export async function PATCH(request: NextRequest) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });
  if (auth.viewer.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'רק מנהל יכול לערוך הגדרות' }, { status: 403 });
  }

  let body: Partial<AppConfig> & { stageMoves?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  // Whitelist the editable keys.
  const patch: Partial<AppConfig> = {};
  if (typeof body.businessName === 'string') patch.businessName = body.businessName.trim() || 'CRM_YE';
  if (typeof body.sidebarSubtitle === 'string') patch.sidebarSubtitle = body.sidebarSubtitle.trim();
  if (typeof body.defaultCaseTitle === 'string') patch.defaultCaseTitle = body.defaultCaseTitle.trim() || 'תיק חדש';
  if (typeof body.defaultFee === 'number' && Number.isFinite(body.defaultFee)) patch.defaultFee = Math.max(0, body.defaultFee);
  if (typeof body.autoCreateCaseOnClient === 'boolean') patch.autoCreateCaseOnClient = body.autoCreateCaseOnClient;
  if (typeof body.seedChecklistByDefault === 'boolean') patch.seedChecklistByDefault = body.seedChecklistByDefault;

  if (Array.isArray(body.companies)) {
    patch.companies = body.companies
      .filter((c) => c && typeof c.value === 'string' && typeof c.label === 'string' && c.value.trim() && c.label.trim())
      .map((c) => {
        // Only a plain #rrggbb colour is stored — it ends up in inline styles.
        const color = typeof c.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color.toLowerCase() : undefined;
        return color ? { value: c.value.trim(), label: c.label.trim(), color } : { value: c.value.trim(), label: c.label.trim() };
      });
  }
  if (Array.isArray(body.paymentMethods)) {
    patch.paymentMethods = body.paymentMethods
      .filter((c) => c && typeof c.value === 'string' && typeof c.label === 'string' && c.value.trim() && c.label.trim())
      .map((c) => ({ value: c.value.trim(), label: c.label.trim() }));
  }
  if (Array.isArray(body.offices)) {
    patch.offices = body.offices
      .filter((c) => c && typeof c.value === 'string' && typeof c.label === 'string' && c.value.trim() && c.label.trim())
      .map((c) => ({ value: c.value.trim(), label: c.label.trim() }));
  }
  if (Array.isArray(body.documentTemplates)) {
    patch.documentTemplates = body.documentTemplates
      .filter((c) => c && typeof c.code === 'string' && typeof c.label === 'string' && c.code.trim() && c.label.trim())
      .map((c) => ({ code: c.code.trim(), label: c.label.trim() }));
  }
  if (Array.isArray(body.stages)) {
    const stages = normalizeStages(body.stages);
    if (!stages.some((s) => s.code !== 'closed' && !s.hidden)) {
      return NextResponse.json({ ok: false, error: 'צריך להשאיר לפחות שלב פעיל אחד לפני "סגור"' }, { status: 400 });
    }
    patch.stages = stages;
  }
  if (Array.isArray(body.phases)) {
    patch.phases = body.phases
      .filter((p) => p && typeof p.id === 'string' && typeof p.label === 'string')
      .map((p) => ({ id: p.id, label: p.label.trim().slice(0, 40) }));
  }
  if (Array.isArray(body.trays)) {
    patch.trays = body.trays
      .filter((t) => t && typeof t.id === 'string')
      .map((t) => ({
        id: t.id,
        label: String(t.label ?? '').trim().slice(0, 40),
        hint: String(t.hint ?? '').trim().slice(0, 80),
        ...(t.hidden ? { hidden: true } : {}),
      }));
  }
  if (Array.isArray(body.clientFields)) patch.clientFields = normalizeFields(body.clientFields, DEFAULT_CLIENT_FIELDS);
  if (Array.isArray(body.caseFields)) patch.caseFields = normalizeFields(body.caseFields, DEFAULT_CASE_FIELDS);
  if (body.modules && typeof body.modules === 'object') {
    patch.modules = {
      tasks: body.modules.tasks !== false,
      chat: body.modules.chat !== false,
      payments: body.modules.payments !== false,
    };
  }
  if (body.texts && typeof body.texts === 'object') {
    // Only known keys, and only wording that differs from the default.
    const texts: Record<string, string> = {};
    for (const [key, value] of Object.entries(body.texts)) {
      if (key in TEXT_DEFAULTS && typeof value === 'string' && value.trim() && value.trim() !== TEXT_DEFAULTS[key]) {
        texts[key] = value.trim().slice(0, 120);
      }
    }
    patch.texts = texts;
  }
  // Where the cases of a removed stage go: { removedCode: targetCode }.
  const stageMoves: Record<string, string> = {};
  if (body.stageMoves && typeof body.stageMoves === 'object') {
    for (const [from, to] of Object.entries(body.stageMoves)) if (typeof to === 'string') stageMoves[from] = to;
  }

  try {
    const saved = await saveConfig(patch, stageMoves);
    return NextResponse.json({ ok: true, data: saved });
  } catch (error) {
    if (error instanceof StageInUseError) {
      return NextResponse.json({ ok: false, error: error.message, inUse: error.inUse }, { status: 409 });
    }
    throw error;
  }
}
