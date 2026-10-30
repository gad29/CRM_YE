// Client and case fields as set in Settings: which values a request may carry
// for the fields added there, and which "required" fields a save is missing.
import type { AppConfig, FieldDef } from '@/lib/domain';

/** Values for Settings-added fields only (known keys, strings); undefined when the request sent none. */
export function cleanExtraInput(raw: unknown, fields: FieldDef[]): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const custom = new Set(fields.filter((f) => !f.builtIn).map((f) => f.key));
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!custom.has(key)) continue;
    if (typeof value === 'string') out[key] = value.slice(0, 2000);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = String(value);
    else if (value === null) out[key] = '';
  }
  return out;
}

/**
 * Required fields left empty. On create every shown required field counts; on
 * update only the ones the request touches (so an old record missing a newly
 * required detail can still be edited, and is flagged as missing instead).
 */
export function missingRequired(values: Record<string, string | number | undefined | null>, fields: FieldDef[], mode: 'create' | 'update') {
  return fields.filter((f) => {
    if (!f.visible || f.need !== 'required') return false;
    if (mode === 'update' && !(f.key in values)) return false;
    const value = values[f.key];
    return value === undefined || value === null || String(value).trim() === '';
  });
}

/** Why a new case can't be opened with these values (null when it can). Defaults the server fills count as filled. */
export function caseInputProblem(
  config: Pick<AppConfig, 'caseFields' | 'companies'>,
  input: { company?: string; caseKind?: string; office?: string; fee?: number; referenceNumber?: string; description?: string; extra?: Record<string, string> },
) {
  if (input.company && !config.companies.some((c) => c.value === input.company)) return 'החברה שנבחרה לא קיימת ברשימת החברות';
  const values = {
    company: input.company,
    caseKind: input.caseKind || 'new',
    office: input.office || 'housing-ministry',
    fee: input.fee ?? 0,
    referenceNumber: input.referenceNumber,
    description: input.description,
    ...input.extra,
  };
  const missing = missingRequired(values, config.caseFields, 'create');
  return missing.length ? requiredError(missing) : null;
}

export function requiredError(missing: FieldDef[]) {
  return missingRequiredMessage(missing.map((f) => f.label));
}

export function missingRequiredMessage(labels: string[]) {
  return labels.length === 1 ? `חסר שדה חובה: ${labels[0]}` : `חסרים שדות חובה: ${labels.join(', ')}`;
}
