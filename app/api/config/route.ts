import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { AppConfig } from '@/lib/domain';
import { getConfig, saveConfig } from '@/lib/store';
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

  let body: Partial<AppConfig>;
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
  if (body.stageLabels && typeof body.stageLabels === 'object') {
    const labels: Record<string, string> = {};
    for (const [key, value] of Object.entries(body.stageLabels)) {
      if (typeof value === 'string' && value.trim()) labels[key] = value.trim();
    }
    patch.stageLabels = labels;
  }

  const saved = await saveConfig(patch);
  return NextResponse.json({ ok: true, data: saved });
}
