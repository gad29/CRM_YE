'use client';

// The one place new work enters the system.
//   New client:            client details → the case → required documents
//   New case for a client: the case → required documents
// Ends on the new case page, where "the next step" takes over.
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useConfig } from '@/components/config-provider';
import { Field, Segmented } from '@/components/ui/bits';
import { IconCheck, IconPlus, IconX } from '@/components/ui/icons';
import { Modal } from '@/components/ui/overlay';
import { useToast } from '@/components/ui/toast';
import { CASE_KIND_LABELS, companyColor, type CaseKind } from '@/lib/domain';

export type WizardStart = { mode: 'client' } | { mode: 'case'; clientId: string; clientName: string };

type ClientLite = { id: string; fullName: string; phone?: string; idNumber?: string };

const digits = (v?: string) => (v || '').replace(/\D/g, '');

export function NewCaseWizard({ start, onClose }: { start: WizardStart; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const config = useConfig();
  const forClient = start.mode === 'case';
  const steps = forClient ? (['case', 'docs'] as const) : (['client', 'case', 'docs'] as const);
  const [step, setStep] = useState(0);
  const current = steps[step];

  const [client, setClient] = useState({ fullName: '', phone: '', idNumber: '', email: '', city: '', address: '', notes: '' });
  const [openCase, setOpenCase] = useState(forClient || config.autoCreateCaseOnClient);
  const [kase, setKase] = useState({
    company: '',
    caseKind: 'new' as CaseKind,
    title: config.defaultCaseTitle,
    fee: config.defaultFee ? String(config.defaultFee) : '',
    office: 'housing-ministry',
  });
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

  function next() {
    setError('');
    if (current === 'client') {
      if (!client.fullName.trim() || !client.phone.trim()) return setError('שם מלא וטלפון הם שדות חובה');
      if (!openCase) return void submit();
    }
    if (current === 'case' && !kase.company) return setError('יש לבחור חברה מטפלת');
    if (step < steps.length - 1) setStep(step + 1);
    else void submit();
  }

  async function submit() {
    setSaving(true);
    setError('');
    const casePayload = {
      title: kase.title.trim() || config.defaultCaseTitle,
      company: kase.company,
      caseKind: kase.caseKind,
      office: kase.office,
      fee: kase.fee ? Number(kase.fee) : 0,
      checklistCodes: codes,
      customChecklist: extra,
    };
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
            body: JSON.stringify({ ...client, createCase: openCase, case: openCase ? casePayload : undefined }),
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

  const STEP_NAMES = { client: 'פרטי הלקוח', case: 'התיק', docs: 'מסמכים נדרשים' } as const;
  const isLast = step === steps.length - 1 || (current === 'client' && !openCase);

  return (
    <Modal
      title={forClient ? `תיק חדש · ${start.clientName}` : 'לקוח חדש'}
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
              חזרה
            </button>
          )}
          <button type="button" className="button" onClick={next} disabled={saving}>
            {saving ? 'שומר…' : isLast ? (forClient ? 'פתיחת התיק' : openCase ? 'שמירה ופתיחת התיק' : 'שמירת הלקוח') : 'המשך'}
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
              <Field label="שם מלא" required>
                <input value={client.fullName} onChange={(e) => setClient({ ...client, fullName: e.target.value })} required autoComplete="off" />
              </Field>
              <Field label="טלפון" required>
                <input value={client.phone} onChange={(e) => setClient({ ...client, phone: e.target.value })} type="tel" dir="ltr" style={{ textAlign: 'right' }} required />
              </Field>
              <Field label="תעודת זהות">
                <input value={client.idNumber} onChange={(e) => setClient({ ...client, idNumber: e.target.value })} inputMode="numeric" dir="ltr" style={{ textAlign: 'right' }} />
              </Field>
              <Field label="אימייל">
                <input value={client.email} onChange={(e) => setClient({ ...client, email: e.target.value })} type="email" dir="ltr" style={{ textAlign: 'right' }} />
              </Field>
              <Field label="עיר">
                <input value={client.city} onChange={(e) => setClient({ ...client, city: e.target.value })} />
              </Field>
              <Field label="כתובת">
                <input value={client.address} onChange={(e) => setClient({ ...client, address: e.target.value })} />
              </Field>
              <Field label="הערות" full>
                <textarea value={client.notes} onChange={(e) => setClient({ ...client, notes: e.target.value })} rows={2} />
              </Field>
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
              לפתוח עכשיו תיק ללקוח
            </label>
          </>
        )}

        {current === 'case' && (
          <>
            <div className="field">
              <span className="field-label">
                חברה מטפלת<span className="req" aria-hidden="true">*</span>
              </span>
              <div className="company-picker" role="radiogroup" aria-label="חברה מטפלת">
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
            <div className="form-grid">
              <Field label="סוג התיק">
                <Segmented
                  label="סוג התיק"
                  value={kase.caseKind}
                  onChange={(v) => setKase({ ...kase, caseKind: v })}
                  options={(Object.entries(CASE_KIND_LABELS) as [CaseKind, string][]).map(([value, label]) => ({ value, label }))}
                />
              </Field>
              <Field label="נושא התיק">
                <input value={kase.title} onChange={(e) => setKase({ ...kase, title: e.target.value })} />
              </Field>
              <Field label="שכר טרחה (₪)">
                <input value={kase.fee} onChange={(e) => setKase({ ...kase, fee: e.target.value })} inputMode="decimal" dir="ltr" style={{ textAlign: 'right' }} />
              </Field>
              <Field label="משרד">
                <select value={kase.office} onChange={(e) => setKase({ ...kase, office: e.target.value })}>
                  {config.offices.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>
            </div>
          </>
        )}

        {current === 'docs' && (
          <>
            <div className="row between">
              <span className="muted small">סמנו אילו מסמכים צריך לאסוף. אפשר לשנות גם אחר כך, מתוך התיק.</span>
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
