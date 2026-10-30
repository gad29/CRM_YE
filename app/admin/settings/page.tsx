'use client';

import '@/app/styles/tools.css';
import '@/app/styles/settings.css';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AppConfig } from '@/lib/domain';
import { useConfigRefresh } from '@/components/config-provider';
import { PageHead } from '@/components/ui/bits';
import { useToast } from '@/components/ui/toast';
import { BlankContractCard, GeneralEditor, OptionListEditor, TemplateEditor, type SaveFn } from './editors';
import { FieldsEditor } from './fields-editor';
import { ImportCard } from './import-card';
import { ModulesEditor, TextsEditor, TraysEditor } from './interface-editor';
import { PipelineEditor } from './pipeline-editor';

const TABS = [
  { id: 'business', label: 'העסק' },
  { id: 'stages', label: 'שלבים' },
  { id: 'client-fields', label: 'פרטי לקוח' },
  { id: 'case-fields', label: 'פרטי תיק' },
  { id: 'companies', label: 'חברות' },
  { id: 'documents', label: 'מסמכים' },
  { id: 'offices', label: 'משרדים' },
  { id: 'payments', label: 'תשלומים' },
  { id: 'interface', label: 'ממשק' },
  { id: 'import', label: 'ייבוא' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** Links saved before the tabs were split. */
const OLD_TABS: Record<string, TabId> = { process: 'stages' };

type Usage = { stages: Record<string, number>; clientFields: Record<string, number>; caseFields: Record<string, number> };
const NO_USAGE: Usage = { stages: {}, clientFields: {}, caseFields: {} };

function SettingsInner() {
  const refresh = useConfigRefresh();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tabParam = params.get('tab') ?? '';
  const tab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : (OLD_TABS[tabParam] ?? 'business');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [usage, setUsage] = useState<Usage>(NO_USAGE);
  const [loadError, setLoadError] = useState(false);

  const loadUsage = useCallback(() => {
    fetch('/api/config/usage')
      .then((r) => r.json())
      .then((d) => d.ok && setUsage(d.data))
      .catch(() => null);
  }, []);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((d) => (d.ok ? setConfig(d.data) : setLoadError(true)))
      .catch(() => setLoadError(true));
    loadUsage();
  }, [loadUsage]);

  const save: SaveFn = useCallback(
    async (patch) => {
      try {
        const res = await fetch('/api/config', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const d = await res.json();
        if (!res.ok || !d.ok) {
          toast(d.error || 'השמירה נכשלה', 'error');
          return false;
        }
        setConfig(d.data);
        refresh();
        if (patch.stages || patch.clientFields || patch.caseFields) loadUsage();
        return true;
      } catch {
        toast('אין חיבור לשרת — לא נשמר', 'error');
        return false;
      }
    },
    [refresh, toast, loadUsage],
  );

  function selectTab(id: TabId) {
    router.replace(`${pathname}?tab=${id}` as never, { scroll: false });
  }

  // Editors keep a local draft; a key built from the saved data resets them after each save.
  const k = (value: unknown) => JSON.stringify(value);

  return (
    <div className="settings-wrap">
      <PageHead title="הגדרות" sub="השלבים, הפרטים, השמות והכפתורים שהמערכת משתמשת בהם. שינוי כאן חל מיד על כל הצוות." />

      <div className="tabs settings-tabs" role="tablist" aria-label="אזורי ההגדרות">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => selectTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {!config ? (
        loadError ? (
          <p className="form-error">ההגדרות לא נטענו. רעננו את הדף.</p>
        ) : (
          <div className="stack">
            <div className="skeleton" style={{ height: 180 }} />
            <div className="skeleton" style={{ height: 120 }} />
          </div>
        )
      ) : (
        <div className="stack" role="tabpanel">
          {tab === 'business' && (
            <GeneralEditor
              key={k([config.businessName, config.sidebarSubtitle, config.defaultCaseTitle, config.defaultFee, config.autoCreateCaseOnClient, config.seedChecklistByDefault])}
              config={config}
              save={save}
            />
          )}
          {tab === 'stages' && (
            <PipelineEditor
              key={k([config.stages, config.phases])}
              stages={config.stages}
              phases={config.phases}
              trays={config.trays}
              usage={usage.stages}
              save={save}
            />
          )}
          {tab === 'client-fields' && <FieldsEditor key={k(config.clientFields)} kind="client" fields={config.clientFields} usage={usage.clientFields} save={save} />}
          {tab === 'case-fields' && <FieldsEditor key={k(config.caseFields)} kind="case" fields={config.caseFields} usage={usage.caseFields} save={save} />}
          {tab === 'companies' && (
            <OptionListEditor
              key={k(config.companies)}
              title="חברות מטפלות"
              sub="החברות שדרכן מוגשים התיקים. הצבע מסמן את תיקי החברה בכל המערכת: בלשונית התיק, ברשימות ובלוח."
              items={config.companies}
              keyPrefix="co"
              field="companies"
              withColor
              save={save}
              addLabel="הוספת חברה"
              placeholder="שם החברה"
            />
          )}
          {tab === 'documents' && (
            <>
              <TemplateEditor key={k(config.documentTemplates)} items={config.documentTemplates} save={save} />
              <BlankContractCard />
            </>
          )}
          {tab === 'offices' && (
            <OptionListEditor
              key={k(config.offices)}
              title="משרדי ממשלה"
              sub="איך כל משרד נקרא במערכת. אפשר לשנות את השם; משרד שאינו ברשימה נבחר בתיק כ&quot;אחר&quot; עם שם חופשי."
              items={config.offices}
              keyPrefix="office"
              field="offices"
              fixed
              save={save}
              addLabel="הוספת משרד"
              placeholder="שם המשרד"
            />
          )}
          {tab === 'payments' && (
            <OptionListEditor
              key={k(config.paymentMethods)}
              title="אמצעי תשלום"
              sub="האפשרויות שמופיעות ברישום תשלום."
              items={config.paymentMethods}
              keyPrefix="pm"
              field="paymentMethods"
              save={save}
              addLabel="הוספת אמצעי"
              placeholder="למשל: העברה בנקאית"
            />
          )}
          {tab === 'interface' && (
            <>
              <ModulesEditor key={k(config.modules)} modules={config.modules} save={save} />
              <TraysEditor key={k(config.trays)} trays={config.trays} save={save} />
              <TextsEditor key={k(config.texts)} texts={config.texts} save={save} />
            </>
          )}
          {tab === 'import' && <ImportCard />}
        </div>
      )}
    </div>
  );
}

export default function AdminSettingsPage() {
  return (
    <Suspense>
      <SettingsInner />
    </Suspense>
  );
}
