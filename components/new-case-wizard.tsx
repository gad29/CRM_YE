'use client';

// The one place new work enters the system.
//   New client:            client details → the case → required documents
//   New case for a client: the case → required documents
// Ends on the new case page, where "the next step" takes over.
// Which details and case fields appear, and which are required, comes from Settings.
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useConfig, useText } from '@/components/config-provider';
import { FieldInput, formFields } from '@/components/field-input';
import { Field, Segmented } from '@/components/ui/bits';
import { IconCheck, IconPlus, IconX } from '@/components/ui/icons';
import { Modal } from '@/components/ui/overlay';
import { useToast } from '@/components/ui/toast';
import { BUILT_IN_CLIENT_FIELD_KEYS, CASE_KIND_LABELS, companyColor, type CaseKind, type FieldDef } from '@/lib/domain';
import { caseInputProblem, missingRequired, requiredError } from '@/lib/fields';

export type WizardStart = { mode: 'client' } | { mode: 'case'; clientId: string; clientName: string };

type ClientLite = { id: string; fullName: string; phone?: string; idNumber?: string };

const digits = (v?: string) => (v || '').replace(/\D/g, '');

/**
 * A client detail input as set in Settings. The ID number keeps its
 * left-to-right numeric keyboard; everything else is the shared FieldInput.
 */
export function ClientFieldInput({ field, value, onChange }: { field: FieldDef; value: string; onChange: (value: string) => void }) {
  if (field.key === 'idNumber') {
    const required = field.need === 'required';
    return (
      <Field label={field.label} required={required} hint={field.need === 'needed' ? 'נדרש להשלמה' : undefined}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          placeholder={field.placeholder || undefined}
          inputMode="numeric"
          dir="ltr"
          style={{ textAlign: 'right' }}
        />
      </Field>
    );
  }
  return <FieldInput field={field} value={value} onChange={onChange} />;
}

/** Split a flat form into the built-in client columns and the Settings-added `extra` (shown fields only). */
export function clientPayload(form: Record<string, string>, fields: FieldDef[]) {
  const top: Record<string, string> = { fullName: form.fullName ?? '' };
  const extra: Record<string, string> = {};
  for (const f of fields) {
    if (!f.visible) continue;
    if (BUILT_IN_CLIENT_FIELD_KEYS.includes(f.key)) top[f.key] = form[f.key] ?? '';
    else extra[f.key] = form[f.key] ?? '';
  }
  return { ...top, extra };
}

/** Case fields the wizard draws itself; other shown ones go through FieldInput. */
const OWN_CASE_FIELDS = ['company', 'caseKind', 'office', 'fee', 'referenceNumber', 'description'];

export function NewCaseWizard({ start, onClose }: { start: WizardStart; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const config = useConfig();
  const t = useText();
  const forClient = start.mode === 'case';
  const steps = forClient ? (['case', 'docs'] as const) : (['client', 'case', 'docs'] as const);
  const [step, setStep] = useState(0);
  const current = steps[step];

  const clientFields = formFields(config.clientFields);
  const customCaseFields = formFields(config.caseFields, OWN_CASE_FIELDS);
  const caseField = (key: string) => config.caseFields.find((f) => f.key === key && f.visible);
  const company = caseField('company');
  const caseKind = caseField('caseKind');
  const fee = caseField('fee');
  const office = caseField('office');
  const reference = caseField('referenceNumber');
  const description = caseField('description');

  const [client, setClient] = useState<Record<string, string>>({ fullName: '' });
  const [openCase, setOpenCase] = useState(forClient || config.autoCreateCaseOnClient);
  const [kase, setKase] = useState({
    company: '',
    caseKind: 'new' as CaseKind,
    title: config.defaultCaseTitle,
    fee: config.defaultFee ? String(config.defaultFee) : '',
    office: 'housing-ministry',
    referenceNumber: '',
    description: '',
  });
  const [caseExtra, setCaseExtra] = useState<Record<string, string>>({});
  const [codes, setCodes] = useState<string[]>(config.seedChecklistByDefault ? config.documentTemplates.map((t) => t.code) : []);
  const [extra, setExtra] = useState<string[]>([]);
  const [extraDraft, setExtraDraft] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Existing clients, to warn before creating a duplicate.
  const [existing, setExisting] = useState<ClientLite[]>([]);
  useEffect(() => {
    if (forClient) return;
    fetch('/api/clients')
      .then((r) => r.json())
      .then((d) => d.ok && setExisting(d.data))
      .catch(() => null);
  }, [forClient]);
  const duplicate = useMemo(() => {
    const id = digits(client.idNumber);
    const phone = digits(client.phone);
    return existing.find((c) => (id.length >= 5 && digits(c.idNumber) === id) || (phone.length >= 9 && digits(c.phone) === phone));
  }, [existing, client.idNumber, client.phone]);

  // The same checks the server makes, so the problem shows before anything is sent.
  function clientProblem() {
    if (!client.fullName?.trim()) return `חסר שדה חובה: ${t('client.fullName')}`;
    const missing = missingRequired(client, config.clientFields, 'create');
    return missing.length ? requiredError(missing) : null;
  }

  function caseValues() {
    const values: Record<string, string> = {};
    for (const f of customCaseFields) values[f.key] = caseExtra[f.key] ?? '';
    return {
      title: kase.title.trim() || config.defaultCaseTitle,
      company: company ? kase.company || undefined : undefined,
      caseKind: caseKind ? kase.caseKind : undefined,
      office: office ? kase.office : undefined,
      fee: fee ? (kase.fee ? Number(kase.fee) : 0) : undefined,
      referenceNumber: reference ? kase.referenceNumber.trim() || undefined : undefined,
      description: description ? kase.description.trim() || undefined : undefined,
      extra: values,
    };
  }

  function next() {
    setError('');
    if (current === 'client') {
      const problem = clientProblem();
      if (problem) return setError(problem);
      if (!openCase) return void submit();
    }
    if (current === 'case') {
      const problem = caseInputProblem(config, caseValues());
      if (problem) return setError(problem);
    }
    if (step < steps.length - 1) setStep(step + 1);
    else void submit();
  }

  async function submit() {
    setSaving(true);
    setError('');
    const casePayload = { ...caseValues(), checklistCodes: codes, customChecklist: extra };
    try {
      const res = forClient
        ? await fetch('/api/cases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: start.clientId, ...casePayload }),
          })
        : await fetch('/api/clients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...clientPayload(client, config.clientFields), createCase: openCase, case: openCase ? casePayload : undefined }),
          });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'השמירה נכשלה');
        return;
      }
      onClose();
      if (forClient) {
        toast('התיק נפתח');
        router.push(`/cases/${data.data.id}` as never);
      } else if (data.data.case) {
        toast(`${data.data.client.fullName} נוסף/ה ונפתח תיק`);
        router.push(`/cases/${data.data.case.id}` as never);
      } else {
        toast(`${data.data.client.fullName} נוסף/ה`);
        router.push(`/clients/${data.data.client.id}` as never);
      }
      router.refresh();
    } catch {
      setError('אין חיבור לשרת — נסו שוב');
    } finally {
      setSaving(false);
    }
  }

  const STEP_NAMES = { client: t('client.detailsTitle'), case: t('wizard.stepCase'), docs: t('wizard.stepDocs') } as const;
  const isLast = step === steps.length - 1 || (current === 'client' && !openCase);

  return (
    <Modal
      title={forClient ? `${t('btn.newCase')} · ${start.clientName}` : t('btn.newClient')}
      size="wide"
      onClose={onClose}
      head={
        <div className="steps" aria-label="שלבים">
          {steps.map((s, i) => (
            <span key={s} style={{ display: 'contents' }}>
              {i > 0 && <span className="steps-sep" />}
              <span className={`steps-item ${i === step ? 'on' : i < step ? 'done' : ''}`}>
                <span className="n">{i < step ? <IconCheck size={13} /> : i + 1}</span>
                {STEP_NAMES[s]}
              </span>
            </span>
          ))}
        </div>
      }
      footer={
        <>
          {error && <span className="form-error" style={{ marginInlineEnd: 'auto' }}>{error}</span>}
          {step > 0 && (
            <button type="button" className="button button-secondary" onClick={() => setStep(step - 1)} disabled={saving}>
              {t('wizard.back')}
            </button>
          )}
          <button type="button" className="button" onClick={next} disabled={saving}>
            {saving
              ? 'שומר…'
              : isLast
                ? forClient
                  ? t('wizard.openCase')
                  : openCase
                    ? t('wizard.saveAndOpen')
                    : t('wizard.saveClient')
                : t('wizard.next')}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
        style={{ display: 'grid', gap: 16 }}
      >
        {current === 'client' && (
          <>
            <div className="form-grid">
              <Field label={t('client.fullName')} required>
                <input value={client.fullName ?? ''} onChange={(e) => setClient({ ...client, fullName: e.target.value })} required autoComplete="off" />
              </Field>
              {clientFields.map((f) => (
                <ClientFieldInput key={f.key} field={f} value={client[f.key] ?? ''} onChange={(v) => setClient((prev) => ({ ...prev, [f.key]: v }))} />
              ))}
            </div>
            {duplicate && (
              <div className="notice warn">
                <span>
                  כבר קיים/ת במערכת <strong>{duplicate.fullName}</strong> עם אותו {digits(duplicate.idNumber) === digits(client.idNumber) && client.idNumber ? 'מספר זהות' : 'טלפון'}.{' '}
                  <a
                    className="text-link"
                    href={`/clients/${duplicate.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      onClose();
                      router.push(`/clients/${duplicate.id}` as never);
                    }}
                  >
                    לכרטיס הלקוח
                  </a>
                </span>
              </div>
            )}
            <label className="checkbox">
              <input type="checkbox" checked={openCase} onChange={(e) => setOpenCase(e.target.checked)} />
              {t('wizard.openCaseNow')}
            </label>
          </>
        )}

        {current === 'case' && (
          <>
            {company && (
              <div className="field">
                <span className="field-label">
                  {company.label}
                  {company.need === 'required' && <span className="req" aria-hidden="true">*</span>}
                </span>
                <div className="company-picker" role="radiogroup" aria-label={company.label}>
                  {config.companies.map((c) => {
                    const color = companyColor(config, c.value);
                    return (
                      <button
                        key={c.value}
                        type="button"
                        role="radio"
                        aria-checked={kase.company === c.value}
                        className={`company-option ${kase.company === c.value ? 'on' : ''}`}
                        style={color ? ({ '--co': color } as CSSProperties) : undefined}
                        onClick={() => setKase({ ...kase, company: c.value })}
                      >
                        <span className="company-option-tab" />
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="form-grid">
              {caseKind && (
                <Field label={caseKind.label}>
                  <Segmented
                    label={caseKind.label}
                    value={kase.caseKind}
                    onChange={(v) => setKase({ ...kase, caseKind: v })}
                    options={(Object.entries(CASE_KIND_LABELS) as [CaseKind, string][]).map(([value, label]) => ({ value, label }))}
                  />
                </Field>
              )}
              <Field label={t('case.title')}>
                <input value={kase.title} onChange={(e) => setKase({ ...kase, title: e.target.value })} />
              </Field>
              {fee && (
                <Field label={`${fee.label} (₪)`}>
                  <input value={kase.fee} onChange={(e) => setKase({ ...kase, fee: e.target.value })} inputMode="decimal" dir="ltr" style={{ textAlign: 'right' }} />
                </Field>
              )}
              {office && (
                <Field label={office.label}>
                  <select value={kase.office} onChange={(e) => setKase({ ...kase, office: e.target.value })}>
                    {config.offices.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>
              )}
              {reference && (
                <Field label={reference.label} required={reference.need === 'required'}>
                  <input
                    value={kase.referenceNumber}
                    onChange={(e) => setKase({ ...kase, referenceNumber: e.target.value })}
                    required={reference.need === 'required'}
                    placeholder={reference.placeholder || (reference.need === 'required' ? undefined : 'אפשר להשאיר ריק ולהוסיף אחר כך')}
                    dir="ltr"
                    style={{ textAlign: 'right' }}
                  />
                </Field>
              )}
              {customCaseFields.map((f) => (
                <FieldInput key={f.key} field={f} value={caseExtra[f.key] ?? ''} onChange={(v) => setCaseExtra((prev) => ({ ...prev, [f.key]: v }))} />
              ))}
              {description && (
                <Field label={description.label} required={description.need === 'required'} full>
                  <textarea
                    rows={2}
                    value={kase.description}
                    onChange={(e) => setKase({ ...kase, description: e.target.value })}
                    required={description.need === 'required'}
                  />
                </Field>
              )}
            </div>
          </>
        )}

        {current === 'docs' && (
          <>
            <div className="row between">
              <span className="muted small">{t('wizard.docsHint')}</span>
              <span className="row">
                <button type="button" className="button button-quiet button-compact" onClick={() => setCodes(config.documentTemplates.map((t) => t.code))}>
                  סימון הכל
                </button>
                <button type="button" className="button button-quiet button-compact" onClick={() => setCodes([])}>
                  ניקוי
                </button>
              </span>
            </div>
            <div className="doc-pick">
              {config.documentTemplates.map((t) => (
                <label key={t.code} className={`doc-pick-item ${codes.includes(t.code) ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={codes.includes(t.code)}
                    onChange={(e) => setCodes((prev) => (e.target.checked ? [...prev, t.code] : prev.filter((c) => c !== t.code)))}
                  />
                  {t.label}
                </label>
              ))}
              {extra.map((label, i) => (
                <span key={`${label}-${i}`} className="doc-pick-item on">
                  <IconCheck size={15} />
                  <span style={{ flex: 1 }}>{label}</span>
                  <button type="button" className="icon-button small" aria-label={`הסרת ${label}`} onClick={() => setExtra(extra.filter((_, j) => j !== i))}>
                    <IconX size={14} />
                  </button>
                </span>
              ))}
            </div>
            <div className="row">
              <input
                className="input"
                style={{ flex: 1 }}
                value={extraDraft}
                placeholder="מסמך נוסף שלא ברשימה…"
                onChange={(e) => setExtraDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (extraDraft.trim()) setExtra([...extra, extraDraft.trim()]);
                    setExtraDraft('');
                  }
                }}
              />
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  if (extraDraft.trim()) setExtra([...extra, extraDraft.trim()]);
                  setExtraDraft('');
                }}
              >
                <IconPlus size={16} /> הוספה
              </button>
            </div>
          </>
        )}
        {/* Enter submits the step. */}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
