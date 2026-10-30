'use client';

// Which details the system keeps about a client or a case: rename, mark as
// needed / required, hide, reorder, and add fields of your own.
import { useRef, useState } from 'react';
import { FIELD_NEED_LABELS, FIELD_TYPE_LABELS, type FieldDef, type FieldNeed, type FieldType } from '@/lib/domain';
import { Segmented } from '@/components/ui/bits';
import { Modal } from '@/components/ui/overlay';
import { IconEye, IconEyeOff, IconLock, IconPlus, IconTrash, IconX } from '@/components/ui/icons';
import { CardShell, same, useSaver, type SaveFn } from './editors';
import { countLabel, moveWithin, randomCode, ReorderButtons } from './shared';

const NEEDS: FieldNeed[] = ['optional', 'needed', 'required'];
const TYPES = Object.keys(FIELD_TYPE_LABELS) as FieldType[];

export function FieldsEditor({
  kind,
  fields,
  usage,
  save,
}: {
  kind: 'client' | 'case';
  fields: FieldDef[];
  usage: Record<string, number>;
  save: SaveFn;
}) {
  const [rows, setRows] = useState<FieldDef[]>(fields);
  const [deleting, setDeleting] = useState<FieldDef | null>(null);
  const [optionDraft, setOptionDraft] = useState<Record<string, string>>({});
  const lastAdded = useRef<string | null>(null);
  const { saving, saved, run } = useSaver(save);

  const isClient = kind === 'client';
  const records = isClient ? ['לקוח אחד', 'לקוחות'] : ['תיק אחד', 'תיקים'];
  const update = (key: string, patch: Partial<FieldDef>) => setRows((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  function add() {
    const key = randomCode('f-');
    lastAdded.current = key;
    setRows((prev) => [...prev, { key, label: '', type: 'text', visible: true, need: 'optional' }]);
  }

  function addOption(field: FieldDef) {
    const value = (optionDraft[field.key] ?? '').trim();
    if (!value) return;
    if (!(field.options ?? []).includes(value)) update(field.key, { options: [...(field.options ?? []), value] });
    setOptionDraft((d) => ({ ...d, [field.key]: '' }));
  }

  function askRemove(field: FieldDef) {
    const saved = fields.some((f) => f.key === field.key);
    if (!saved || !usage[field.key]) {
      setRows((prev) => prev.filter((f) => f.key !== field.key));
      return;
    }
    setDeleting(field);
  }

  const unnamed = rows.some((f) => !f.label.trim());
  const emptySelect = rows.find((f) => !f.builtIn && f.type === 'select' && !(f.options ?? []).length);
  const blocked = unnamed ? 'לכל שדה צריך שם' : emptySelect ? `לשדה "${emptySelect.label}" חסרות אפשרויות לבחירה` : undefined;

  return (
    <>
      <CardShell
        title={isClient ? 'פרטי הלקוח' : 'פרטי התיק'}
        sub={
          <>
            {isClient ? 'הפרטים שנשמרים על כל לקוח, בטופס לקוח חדש ובדף הלקוח.' : 'הפרטים שנשמרים על כל תיק, בפתיחת תיק ובלשונית "פרטי התיק".'}{' '}
            <strong>נדרש להשלמה</strong> — אפשר לשמור בלעדיו, אבל {isClient ? 'הלקוח יסומן ב"חסרים פרטים" עד שימולא' : 'התיק יסומן כחסר עד שימולא'}.{' '}
            <strong>חובה</strong> — אי אפשר לשמור בלעדיו. {isClient ? 'שם הלקוח' : 'כותרת התיק'} תמיד קיים; את השם שלו משנים בלשונית ממשק, תחת ניסוחים.
          </>
        }
        dirty={!same(rows, fields)}
        blocked={blocked}
        saving={saving}
        saved={saved}
        onSave={() =>
          run({
            [isClient ? 'clientFields' : 'caseFields']: rows.map((f) => ({ ...f, label: f.label.trim(), placeholder: f.placeholder?.trim() || undefined })),
          })
        }
        extra={
          <button type="button" className="button button-secondary button-compact" onClick={add}>
            <IconPlus size={15} /> הוספת שדה
          </button>
        }
      >
        <ol className="field-edit-list">
          {rows.map((field, index) => {
            const filled = usage[field.key];
            return (
              <li key={field.key} className={`field-edit ${field.visible ? '' : 'is-hidden'}`}>
                <div className="field-edit-main">
                  <input
                    className="input"
                    value={field.label}
                    onChange={(e) => update(field.key, { label: e.target.value })}
                    placeholder="שם השדה"
                    autoFocus={lastAdded.current === field.key}
                    aria-label="שם השדה"
                  />
                  {field.builtIn ? (
                    <span className="chip field-type" title="שדה מובנה: אפשר לשנות שם, להסתיר ולסדר, אבל לא למחוק או לשנות סוג">
                      <IconLock size={12} /> {FIELD_TYPE_LABELS[field.type]}
                    </span>
                  ) : (
                    <select
                      className="select field-type-select"
                      value={field.type}
                      onChange={(e) => update(field.key, { type: e.target.value as FieldType })}
                      aria-label={`סוג השדה ${field.label}`}
                    >
                      {TYPES.map((t) => (
                        <option key={t} value={t}>
                          {FIELD_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  )}
                  <span className="stage-edit-tools">
                    <ReorderButtons
                      label={field.label || 'השדה'}
                      canUp={index > 0}
                      canDown={index < rows.length - 1}
                      onUp={() => setRows((prev) => moveWithin(prev, index, -1))}
                      onDown={() => setRows((prev) => moveWithin(prev, index, 1))}
                    />
                    <button
                      type="button"
                      className="icon-button small"
                      onClick={() => update(field.key, { visible: !field.visible })}
                      aria-pressed={!field.visible}
                      aria-label={field.visible ? `הסתרת ${field.label}` : `הצגת ${field.label}`}
                      title={field.visible ? 'הסתרת השדה מהטפסים' : 'השדה מוסתר — לחיצה מחזירה אותו'}
                    >
                      {field.visible ? <IconEye size={15} /> : <IconEyeOff size={15} />}
                    </button>
                    {!field.builtIn && (
                      <button type="button" className="icon-button small" onClick={() => askRemove(field)} aria-label={`מחיקת ${field.label || 'השדה'}`} title="מחיקת השדה">
                        <IconTrash size={15} />
                      </button>
                    )}
                  </span>
                </div>

                <div className="field-edit-more">
                  {field.visible ? (
                    <Segmented
                      label={`עד כמה ${field.label || 'השדה'} נחוץ`}
                      value={field.need}
                      onChange={(need) => update(field.key, { need })}
                      options={NEEDS.map((n) => ({ value: n, label: FIELD_NEED_LABELS[n] }))}
                    />
                  ) : (
                    <span className="tiny muted">מוסתר — לא מופיע בטפסים ולא נבדק. ערכים שכבר נשמרו נשארים.</span>
                  )}
                  {field.visible && (
                    <label className="checkbox">
                      <input type="checkbox" checked={Boolean(field.inList)} onChange={(e) => update(field.key, { inList: e.target.checked || undefined })} />
                      {isClient ? 'מוצג ברשימת הלקוחות' : 'מוצג בכותרת התיק'}
                    </label>
                  )}
                  {filled ? <span className="tiny muted">{countLabel(filled, `מולא ב${records[0]}`, `${records[1]} מילאו`)}</span> : null}
                </div>

                {!field.builtIn && field.type === 'select' && (
                  <div className="option-chips">
                    {(field.options ?? []).map((o) => (
                      <span key={o} className="chip option-chip">
                        {o}
                        <button
                          type="button"
                          onClick={() => update(field.key, { options: (field.options ?? []).filter((x) => x !== o) })}
                          aria-label={`הסרת האפשרות ${o}`}
                        >
                          <IconX size={12} />
                        </button>
                      </span>
                    ))}
                    <input
                      className="input option-input"
                      value={optionDraft[field.key] ?? ''}
                      onChange={(e) => setOptionDraft((d) => ({ ...d, [field.key]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addOption(field);
                        }
                      }}
                      placeholder="אפשרות חדשה, ואז Enter"
                      aria-label={`הוספת אפשרות לשדה ${field.label}`}
                    />
                    <button type="button" className="button button-quiet button-compact" onClick={() => addOption(field)}>
                      הוספה
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </CardShell>

      {deleting && (
        <Modal
          title={`מחיקת השדה "${deleting.label}"`}
          size="narrow"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setRows((prev) => prev.filter((f) => f.key !== deleting.key));
                  setDeleting(null);
                }}
              >
                מחיקת השדה
              </button>
              <button type="button" className="button button-quiet" onClick={() => setDeleting(null)}>
                ביטול
              </button>
            </>
          }
        >
          <p className="ask-text">
            {countLabel(usage[deleting.key], `${records[0]} מילא`, `${records[1]} מילאו`)} את השדה הזה. הערכים נשארים שמורים, אבל לא יוצגו יותר בשום מקום. אם תחזירו
            שדה בשם הזה — זה יהיה שדה חדש וריק.
          </p>
          <p className="tiny muted">המחיקה נשמרת רק כשלוחצים &quot;שמירה&quot;.</p>
        </Modal>
      )}
    </>
  );
}
