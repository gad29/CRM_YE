'use client';

// One input for a client / case field as defined in Settings, so every form
// shows a field the same way. Built-in select fields (company, office, case
// kind) are rendered by their own screens; this covers everything else.
import { Field } from '@/components/ui/bits';
import { fieldValue, type FieldDef } from '@/lib/domain';

const LTR_TYPES = new Set(['phone', 'email', 'number']);

export const YES = 'כן';
export const NO = 'לא';

export function FieldInput({
  field,
  value,
  onChange,
  hint,
}: {
  field: FieldDef;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  const required = field.need === 'required';
  const ltr = LTR_TYPES.has(field.type);
  const common = {
    value: value ?? '',
    required,
    placeholder: field.placeholder || undefined,
    dir: ltr ? ('ltr' as const) : undefined,
    style: ltr ? { textAlign: 'right' as const } : undefined,
  };

  let control;
  switch (field.type) {
    case 'longtext':
      control = <textarea rows={3} {...common} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'select':
      control = (
        <select value={value ?? ''} required={required} onChange={(e) => onChange(e.target.value)}>
          <option value="">{required ? 'בחירה' : '—'}</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {value && !(field.options ?? []).includes(value) && <option value={value}>{value}</option>}
        </select>
      );
      break;
    case 'yesno':
      control = (
        <div className="segmented" role="radiogroup" aria-label={field.label}>
          {[YES, NO].map((choice) => (
            <button key={choice} type="button" role="radio" aria-checked={value === choice} className={value === choice ? 'on' : ''} onClick={() => onChange(value === choice ? '' : choice)}>
              {choice}
            </button>
          ))}
        </div>
      );
      break;
    default:
      control = (
        <input
          {...common}
          type={field.type === 'phone' ? 'tel' : field.type === 'email' ? 'email' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          inputMode={field.type === 'number' ? 'decimal' : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }

  return (
    <Field label={field.label} required={required} hint={hint ?? (field.need === 'needed' ? 'נדרש להשלמה' : undefined)} full={field.type === 'longtext'}>
      {control}
    </Field>
  );
}

/** A saved value for display ("—" when empty; dates in Hebrew format). */
export function formatFieldValue(field: FieldDef, record: { extra?: Record<string, string> }) {
  const raw = fieldValue(record, field.key).trim();
  if (!raw) return '';
  if (field.type === 'date') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString('he-IL');
  }
  return raw;
}

/** The fields to show in a form: shown ones, minus keys a screen renders itself. */
export function formFields(fields: FieldDef[], skip: string[] = []) {
  return fields.filter((f) => f.visible && !skip.includes(f.key));
}
