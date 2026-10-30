'use client';

// Editors for the runtime configuration (lib/domain AppConfig). Each card
// keeps its own draft and saves only its own keys.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { COMPANY_COLORS, type AppConfig, type ConfigOption } from '@/lib/domain';
import { Field } from '@/components/ui/bits';
import { IconCheck, IconDownload, IconFile, IconPlus, IconUpload, IconX } from '@/components/ui/icons';
import { useToast } from '@/components/ui/toast';

/** A config patch; stageMoves sends where the cases of removed stages go. */
export type ConfigPatch = Partial<AppConfig> & { stageMoves?: Record<string, string> };

export type SaveFn = (patch: ConfigPatch) => Promise<boolean>;

export function useSaver(save: SaveFn) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  async function run(patch: ConfigPatch) {
    setSaving(true);
    setSaved(false);
    const ok = await save(patch);
    setSaving(false);
    if (ok) {
      setSaved(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setSaved(false), 2500);
    }
  }
  return { saving, saved, run };
}

export function CardShell({
  title,
  sub,
  children,
  onSave,
  saving,
  saved,
  dirty,
  extra,
  blocked,
}: {
  title: string;
  sub?: ReactNode;
  children: ReactNode;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  dirty: boolean;
  extra?: ReactNode;
  /** Why saving is not possible right now (shown instead of the unsaved note). */
  blocked?: string;
}) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2 className="card-title">{title}</h2>
          {sub && <div className="card-sub">{sub}</div>}
        </div>
      </div>
      {children}
      <div className="card-foot">
        {extra}
        <button type="button" className="button button-compact" disabled={saving || !dirty || Boolean(blocked)} onClick={onSave}>
          {saving ? 'שומר…' : 'שמירה'}
        </button>
        {saved && (
          <span className="saved-note">
            <IconCheck size={15} /> נשמר
          </span>
        )}
        {dirty && blocked && !saving && <span className="tiny settings-blocked">{blocked}</span>}
        {dirty && !blocked && !saving && !saved && <span className="tiny muted">יש שינויים שלא נשמרו</span>}
      </div>
    </section>
  );
}

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── Business details ─────────────────────────────────────────────────────────

export function GeneralEditor({ config, save }: { config: AppConfig; save: SaveFn }) {
  const initial = {
    businessName: config.businessName,
    sidebarSubtitle: config.sidebarSubtitle,
    defaultCaseTitle: config.defaultCaseTitle,
    defaultFee: String(config.defaultFee ?? 0),
    autoCreateCaseOnClient: config.autoCreateCaseOnClient,
    seedChecklistByDefault: config.seedChecklistByDefault,
  };
  const [draft, setDraft] = useState(initial);
  const { saving, saved, run } = useSaver(save);
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <CardShell
      title="פרטי העסק"
      sub="השם מופיע בסרגל הצד, במסך הכניסה ובכותרת הדפדפן."
      dirty={!same(draft, initial)}
      saving={saving}
      saved={saved}
      onSave={() =>
        run({
          businessName: draft.businessName,
          sidebarSubtitle: draft.sidebarSubtitle,
          defaultCaseTitle: draft.defaultCaseTitle,
          defaultFee: Number(draft.defaultFee) || 0,
          autoCreateCaseOnClient: draft.autoCreateCaseOnClient,
          seedChecklistByDefault: draft.seedChecklistByDefault,
        })
      }
    >
      <div className="form-grid">
        <Field label="שם העסק">
          <input value={draft.businessName} onChange={(e) => set({ businessName: e.target.value })} />
        </Field>
        <Field label="שורה מתחת לשם">
          <input value={draft.sidebarSubtitle} onChange={(e) => set({ sidebarSubtitle: e.target.value })} />
        </Field>
        <Field label="שם ברירת המחדל לתיק חדש">
          <input value={draft.defaultCaseTitle} onChange={(e) => set({ defaultCaseTitle: e.target.value })} />
        </Field>
        <Field label="שכר טרחה ברירת מחדל (₪)">
          <input type="number" min="0" inputMode="decimal" value={draft.defaultFee} onChange={(e) => set({ defaultFee: e.target.value })} />
        </Field>
        <div className="full stack" style={{ gap: 10, marginTop: 4 }}>
          <label className="checkbox">
            <input type="checkbox" checked={draft.autoCreateCaseOnClient} onChange={(e) => set({ autoCreateCaseOnClient: e.target.checked })} />
            לקוח חדש נפתח יחד עם תיק
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={draft.seedChecklistByDefault} onChange={(e) => set({ seedChecklistByDefault: e.target.checked })} />
            תיק חדש מתחיל עם רשימת המסמכים הנדרשים
          </label>
        </div>
      </div>
    </CardShell>
  );
}

// ── Lists of {value, label} (companies, offices, payment methods) ─────────────

export function OptionListEditor({
  title,
  sub,
  items,
  keyPrefix,
  field,
  save,
  withColor = false,
  addLabel,
  placeholder,
  fixed = false,
}: {
  title: string;
  sub: string;
  items: ConfigOption[];
  keyPrefix: string;
  field: 'companies' | 'paymentMethods' | 'offices';
  save: SaveFn;
  withColor?: boolean;
  addLabel: string;
  placeholder: string;
  /** Rename only: rows can't be added or removed (their keys are used in code). */
  fixed?: boolean;
}) {
  const colorOf = (row: ConfigOption) => row.color || COMPANY_COLORS[row.value] || '#64748b';
  const normalize = (list: ConfigOption[]) =>
    list.map((r) => (withColor && r.value !== 'none' ? { ...r, color: colorOf(r) } : r));
  const [rows, setRows] = useState<ConfigOption[]>(() => normalize(items));
  const { saving, saved, run } = useSaver(save);
  const lastAdded = useRef<string | null>(null);

  const update = (index: number, patch: Partial<ConfigOption>) => setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const remove = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index));
  function add() {
    const value = `${keyPrefix}-${Date.now().toString(36)}`;
    lastAdded.current = value;
    setRows((prev) => [...prev, withColor ? { value, label: '', color: '#64748b' } : { value, label: '' }]);
  }

  const cleaned = rows.filter((r) => r.label.trim());

  return (
    <CardShell
      title={title}
      sub={sub}
      dirty={!same(cleaned, normalize(items))}
      saving={saving}
      saved={saved}
      onSave={() => run({ [field]: cleaned } as Partial<AppConfig>)}
      extra={
        fixed ? undefined : (
          <button type="button" className="button button-secondary button-compact" onClick={add}>
            <IconPlus size={15} /> {addLabel}
          </button>
        )
      }
    >
      <div className="edit-list">
        {rows.map((row, index) => (
          <div key={row.value} className="edit-row">
            {withColor &&
              (row.value === 'none' ? (
                <span className="swatch-input" style={{ display: 'grid', placeItems: 'center', cursor: 'default' }} aria-hidden="true" />
              ) : (
                <input
                  type="color"
                  className="swatch-input"
                  value={colorOf(row)}
                  onChange={(e) => update(index, { color: e.target.value })}
                  aria-label={`הצבע של ${row.label || 'השורה'}`}
                />
              ))}
            <input
              className="input"
              value={row.label}
              onChange={(e) => update(index, { label: e.target.value })}
              placeholder={placeholder}
              autoFocus={lastAdded.current === row.value}
              aria-label="שם לתצוגה"
            />
            {!fixed && (
              <button type="button" className="icon-button small" onClick={() => remove(index)} aria-label={`הסרת ${row.label || 'השורה'}`}>
                <IconX size={15} />
              </button>
            )}
          </div>
        ))}
      </div>
      {withColor && cleaned.some((r) => r.value !== 'none') && (
        <div className="company-preview" aria-label="תצוגה מקדימה">
          {cleaned
            .filter((r) => r.value !== 'none')
            .map((r) => (
              <div key={r.value} className="folder" style={{ '--co': colorOf(r) } as CSSProperties}>
                <span className="folder-tab">{r.label}</span>
                <div className="tiny muted">כך ייראה תיק של {r.label}</div>
              </div>
            ))}
        </div>
      )}
    </CardShell>
  );
}

// ── Document checklist library ───────────────────────────────────────────────

export function TemplateEditor({ items, save }: { items: { code: string; label: string }[]; save: SaveFn }) {
  const [rows, setRows] = useState(items);
  const { saving, saved, run } = useSaver(save);
  const lastAdded = useRef<string | null>(null);
  const cleaned = rows.filter((r) => r.label.trim());

  return (
    <CardShell
      title="המסמכים שמבקשים מכל לקוח"
      sub="הרשימה שמוצעת בפתיחת תיק. בכל תיק אפשר עדיין להוסיף ולהוריד מסמכים."
      dirty={!same(cleaned, items)}
      saving={saving}
      saved={saved}
      onSave={() => run({ documentTemplates: cleaned })}
      extra={
        <button
          type="button"
          className="button button-secondary button-compact"
          onClick={() => {
            const code = `doc-${Date.now().toString(36)}`;
            lastAdded.current = code;
            setRows((prev) => [...prev, { code, label: '' }]);
          }}
        >
          <IconPlus size={15} /> הוספת מסמך
        </button>
      }
    >
      <div className="edit-list">
        {rows.map((row, index) => (
          <div key={row.code} className="edit-row">
            <span className="doc-icon" style={{ width: 30, height: 36 }}>
              <IconFile size={15} />
            </span>
            <input
              className="input"
              value={row.label}
              onChange={(e) => setRows((prev) => prev.map((r, i) => (i === index ? { ...r, label: e.target.value } : r)))}
              placeholder="שם המסמך, למשל: תלושי שכר אחרונים"
              autoFocus={lastAdded.current === row.code}
              aria-label="שם המסמך"
            />
            <button type="button" className="icon-button small" onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))} aria-label={`הסרת ${row.label || 'המסמך'}`}>
              <IconX size={15} />
            </button>
          </div>
        ))}
      </div>
    </CardShell>
  );
}

// ── Blank rent-contract form ─────────────────────────────────────────────────

type BlankContractMeta = { originalName: string; mimeType: string; uploadedAt: string } | null;

export function BlankContractCard() {
  const toast = useToast();
  const [meta, setMeta] = useState<BlankContractMeta>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  function reload() {
    fetch('/api/settings/blank-contract')
      .then((r) => r.json())
      .then((d) => d.ok && setMeta(d.data))
      .catch(() => null)
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function upload(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', files[0]);
      const res = await fetch('/api/settings/blank-contract', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'ההעלאה נכשלה');
        return;
      }
      toast('הטופס הועלה');
      reload();
    } catch {
      setError('אין חיבור לשרת — הקובץ לא הועלה');
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    if (!window.confirm('להסיר את טופס חוזה השכירות הריק?')) return;
    await fetch('/api/settings/blank-contract', { method: 'DELETE' });
    toast('הטופס הוסר');
    reload();
  }

  const picker = (label: ReactNode, className: string) => (
    <label className={className} style={{ cursor: 'pointer' }}>
      {label}
      <input type="file" hidden accept=".pdf,.doc,.docx,image/*" onChange={(e) => upload(e.target.files)} />
    </label>
  );

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2 className="card-title">טופס חוזה שכירות ריק</h2>
          <div className="card-sub">מעלים פעם אחת, והוא זמין להורדה מכל תיק בשורה &quot;חוזה שכירות&quot;.</div>
        </div>
      </div>
      {loading ? (
        <div className="skeleton" style={{ height: 52 }} />
      ) : meta ? (
        <div className="doc-row" style={{ borderBottom: 0 }}>
          <span className="doc-icon">
            <IconFile size={17} />
          </span>
          <div className="doc-name">
            <div className="strong truncate">{meta.originalName}</div>
            <div className="tiny muted">הועלה {new Date(meta.uploadedAt).toLocaleDateString('he-IL')}</div>
          </div>
          <div className="doc-actions">
            <a className="button button-secondary button-compact" href="/api/templates/blank-contract">
              <IconDownload size={15} /> הורדה
            </a>
            {picker(uploading ? 'מעלה…' : 'החלפה', 'button button-secondary button-compact')}
            <button type="button" className="button button-quiet button-compact" onClick={remove}>
              הסרה
            </button>
          </div>
        </div>
      ) : (
        <div className="dropzone">
          {picker(
            <span className="row" style={{ justifyContent: 'center' }}>
              <IconUpload size={17} /> {uploading ? 'מעלה…' : 'העלאת טופס ריק (PDF, Word או תמונה)'}
            </span>,
            'text-link',
          )}
        </div>
      )}
      {error && (
        <p className="form-error" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}
    </section>
  );
}
