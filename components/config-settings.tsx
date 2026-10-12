'use client';

import { useEffect, useState } from 'react';
import { CASE_STAGES, STAGE_LABELS, type AppConfig, type CaseStage, type ConfigOption } from '@/lib/domain';
import { useConfigRefresh } from '@/components/config-provider';

function SavedTag({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="text-feedback-success" style={{ fontWeight: 600, fontSize: 13 }}>✓ נשמר</span>;
}

/** Editor for a {value,label} list (companies, payment methods). */
function OptionListEditor({
  title,
  hint,
  items,
  keyPrefix,
  onSave,
  saving,
  saved,
}: {
  title: string;
  hint: string;
  items: ConfigOption[];
  keyPrefix: string;
  onSave: (rows: ConfigOption[]) => void;
  saving: boolean;
  saved: boolean;
}) {
  const [rows, setRows] = useState<ConfigOption[]>(items);

  function update(index: number, label: string) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, label } : r)));
  }
  function remove(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }
  function add() {
    setRows((prev) => [...prev, { value: `${keyPrefix}-${Date.now().toString(36)}`, label: '' }]);
  }

  return (
    <div className="card">
      <div className="section-heading">
        <h3 style={{ margin: 0 }}>{title}</h3>
        <SavedTag show={saved} />
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>{hint}</p>
      {rows.map((row, index) => (
        <div key={row.value} className="doc-row" style={{ gap: 8 }}>
          <input
            value={row.label}
            onChange={(e) => update(index, e.target.value)}
            placeholder="שם לתצוגה"
            style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text)' }}
          />
          <button type="button" className="doc-action-btn reject" onClick={() => remove(index)} title="מחק">✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <button type="button" className="button button-secondary button-compact" onClick={add}>+ הוסף</button>
        <button
          type="button"
          className="button button-compact"
          disabled={saving}
          onClick={() => onSave(rows.filter((r) => r.label.trim()))}
        >
          {saving ? 'שומר…' : 'שמור'}
        </button>
      </div>
    </div>
  );
}

/** Editor for the document-template library ({code,label}). */
function TemplateEditor({
  items,
  onSave,
  saving,
  saved,
}: {
  items: { code: string; label: string }[];
  onSave: (rows: { code: string; label: string }[]) => void;
  saving: boolean;
  saved: boolean;
}) {
  const [rows, setRows] = useState(items);

  function update(index: number, label: string) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, label } : r)));
  }
  function remove(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }
  function add() {
    setRows((prev) => [...prev, { code: `doc-${Date.now().toString(36)}`, label: '' }]);
  }

  return (
    <div className="card">
      <div className="section-heading">
        <h3 style={{ margin: 0 }}>רשימת המסמכים הנדרשים (ברירת מחדל)</h3>
        <SavedTag show={saved} />
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
        אלה המסמכים שמוצעים ונטענים בתיק חדש. אפשר להוסיף, לערוך שם ולמחוק — לכל תיק אפשר עדיין לשנות בנפרד.
      </p>
      {rows.map((row, index) => (
        <div key={row.code} className="doc-row" style={{ gap: 8 }}>
          <input
            value={row.label}
            onChange={(e) => update(index, e.target.value)}
            placeholder="שם המסמך"
            style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text)' }}
          />
          <button type="button" className="doc-action-btn reject" onClick={() => remove(index)} title="מחק">✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" className="button button-secondary button-compact" onClick={add}>+ הוסף מסמך</button>
        <button
          type="button"
          className="button button-compact"
          disabled={saving}
          onClick={() => onSave(rows.filter((r) => r.label.trim()))}
        >
          {saving ? 'שומר…' : 'שמור'}
        </button>
      </div>
    </div>
  );
}

/** Editor for the Hebrew wording of each pipeline stage. */
function StageLabelsEditor({
  labels,
  onSave,
  saving,
  saved,
}: {
  labels: Record<string, string>;
  onSave: (labels: Record<string, string>) => void;
  saving: boolean;
  saved: boolean;
}) {
  const [rows, setRows] = useState<Record<string, string>>(labels);

  return (
    <div className="card">
      <div className="section-heading">
        <h3 style={{ margin: 0 }}>שמות שלבי התיק</h3>
        <SavedTag show={saved} />
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
        שינוי הניסוח בלבד — סדר השלבים והלוגיקה נשמרים.
      </p>
      {(CASE_STAGES as CaseStage[]).map((stage) => (
        <div key={stage} className="doc-row" style={{ gap: 8 }}>
          <span className="muted" style={{ minWidth: 120, fontSize: 12 }}>{STAGE_LABELS[stage]}</span>
          <input
            value={rows[stage] ?? ''}
            onChange={(e) => setRows((prev) => ({ ...prev, [stage]: e.target.value }))}
            style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text)' }}
          />
        </div>
      ))}
      <button
        type="button"
        className="button button-compact"
        disabled={saving}
        style={{ marginTop: 12 }}
        onClick={() => onSave(rows)}
      >
        {saving ? 'שומר…' : 'שמור'}
      </button>
    </div>
  );
}

export function ConfigSettings() {
  const refresh = useConfigRefresh();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [general, setGeneral] = useState({
    businessName: '',
    sidebarSubtitle: '',
    defaultCaseTitle: '',
    defaultFee: '',
    autoCreateCaseOnClient: true,
    seedChecklistByDefault: true,
  });
  const [savingSection, setSavingSection] = useState('');
  const [savedSection, setSavedSection] = useState('');

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setConfig(d.data);
          setGeneral({
            businessName: d.data.businessName,
            sidebarSubtitle: d.data.sidebarSubtitle,
            defaultCaseTitle: d.data.defaultCaseTitle,
            defaultFee: String(d.data.defaultFee ?? 0),
            autoCreateCaseOnClient: d.data.autoCreateCaseOnClient,
            seedChecklistByDefault: d.data.seedChecklistByDefault,
          });
        }
      })
      .catch(() => null);
  }, []);

  async function save(patch: Partial<AppConfig>, section: string) {
    setSavingSection(section);
    setSavedSection('');
    try {
      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const d = await res.json();
      if (d.ok) {
        setConfig(d.data);
        refresh();
        setSavedSection(section);
        setTimeout(() => setSavedSection(''), 2500);
      }
    } finally {
      setSavingSection('');
    }
  }

  if (!config) return <div className="card muted" style={{ padding: 24 }}>טוען הגדרות…</div>;

  return (
    <div className="grid" style={{ gap: 18 }}>
      {/* General & branding */}
      <div className="card">
        <div className="section-heading">
          <h3 style={{ margin: 0 }}>כללי ומיתוג</h3>
          <SavedTag show={savedSection === 'general'} />
        </div>
        <div className="form-grid cols-2">
          <div className="field">
            <label>שם העסק (מוצג בסרגל ובכותרת)</label>
            <input value={general.businessName} onChange={(e) => setGeneral({ ...general, businessName: e.target.value })} />
          </div>
          <div className="field">
            <label>תת-כותרת בסרגל</label>
            <input value={general.sidebarSubtitle} onChange={(e) => setGeneral({ ...general, sidebarSubtitle: e.target.value })} />
          </div>
          <div className="field">
            <label>נושא ברירת מחדל לתיק חדש</label>
            <input value={general.defaultCaseTitle} onChange={(e) => setGeneral({ ...general, defaultCaseTitle: e.target.value })} />
          </div>
          <div className="field">
            <label>שכר טרחה ברירת מחדל (₪)</label>
            <input type="number" min="0" value={general.defaultFee} onChange={(e) => setGeneral({ ...general, defaultFee: e.target.value })} />
          </div>
        </div>
        <label className="choice-card" style={{ marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={general.autoCreateCaseOnClient}
            onChange={(e) => setGeneral({ ...general, autoCreateCaseOnClient: e.target.checked })}
          />
          <span>פתיחת לקוח חדש פותחת אוטומטית תיק</span>
        </label>
        <label className="choice-card" style={{ marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={general.seedChecklistByDefault}
            onChange={(e) => setGeneral({ ...general, seedChecklistByDefault: e.target.checked })}
          />
          <span>טעינת רשימת המסמכים הנדרשים בתיק חדש כברירת מחדל</span>
        </label>
        <button
          type="button"
          className="button button-compact"
          disabled={savingSection === 'general'}
          onClick={() =>
            save(
              {
                businessName: general.businessName,
                sidebarSubtitle: general.sidebarSubtitle,
                defaultCaseTitle: general.defaultCaseTitle,
                defaultFee: Number(general.defaultFee) || 0,
                autoCreateCaseOnClient: general.autoCreateCaseOnClient,
                seedChecklistByDefault: general.seedChecklistByDefault,
              },
              'general',
            )
          }
        >
          {savingSection === 'general' ? 'שומר…' : 'שמור'}
        </button>
      </div>

      <OptionListEditor
        key={`companies-${config.companies.length}`}
        title="חברות מטפלות"
        hint="החברות שדרכן מטופלים התיקים (מילגם, אלונים, מעוף, ועוד)."
        items={config.companies}
        keyPrefix="co"
        saving={savingSection === 'companies'}
        saved={savedSection === 'companies'}
        onSave={(rows) => save({ companies: rows }, 'companies')}
      />

      <TemplateEditor
        key={`templates-${config.documentTemplates.length}`}
        items={config.documentTemplates}
        saving={savingSection === 'documentTemplates'}
        saved={savedSection === 'documentTemplates'}
        onSave={(rows) => save({ documentTemplates: rows }, 'documentTemplates')}
      />

      <OptionListEditor
        key={`payments-${config.paymentMethods.length}`}
        title="אמצעי תשלום"
        hint="האפשרויות שמופיעות ברישום תשלום."
        items={config.paymentMethods}
        keyPrefix="pm"
        saving={savingSection === 'paymentMethods'}
        saved={savedSection === 'paymentMethods'}
        onSave={(rows) => save({ paymentMethods: rows }, 'paymentMethods')}
      />

      <StageLabelsEditor
        labels={config.stageLabels}
        saving={savingSection === 'stageLabels'}
        saved={savedSection === 'stageLabels'}
        onSave={(labels) => save({ stageLabels: labels }, 'stageLabels')}
      />
    </div>
  );
}
