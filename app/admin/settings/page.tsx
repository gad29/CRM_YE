'use client';

import '@/app/styles/tools.css';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AppConfig } from '@/lib/domain';
import { useConfigRefresh } from '@/components/config-provider';
import { PageHead } from '@/components/ui/bits';
import { useToast } from '@/components/ui/toast';
import { BlankContractCard, GeneralEditor, OptionListEditor, StageLabelsEditor, TemplateEditor, type SaveFn } from './editors';
import { ImportCard } from './import-card';

const TABS = [
  { id: 'business', label: 'העסק' },
  { id: 'companies', label: 'חברות' },
  { id: 'documents', label: 'מסמכים' },
  { id: 'process', label: 'שלבים ומשרדים' },
  { id: 'payments', label: 'תשלומים' },
  { id: 'import', label: 'ייבוא' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function SettingsInner() {
  const refresh = useConfigRefresh();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tabParam = params.get('tab');
  const tab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : 'business';
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((d) => (d.ok ? setConfig(d.data) : setLoadError(true)))
      .catch(() => setLoadError(true));
  }, []);

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
        return true;
      } catch {
        toast('אין חיבור לשרת — לא נשמר', 'error');
        return false;
      }
    },
    [refresh, toast],
  );

  function selectTab(id: TabId) {
    router.replace(`${pathname}?tab=${id}` as never, { scroll: false });
  }

  // Editors keep a local draft; a key built from the saved data resets them after each save.
  const k = (value: unknown) => JSON.stringify(value);

  return (
    <div className="settings-wrap">
      <PageHead title="הגדרות" sub="השמות, החברות, המסמכים והשלבים שהמערכת משתמשת בהם. שינוי כאן חל מיד על כל הצוות." />

      <div className="tabs" role="tablist" aria-label="אזורי ההגדרות">
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
          {tab === 'process' && (
            <>
              <StageLabelsEditor key={k(config.stageLabels)} labels={config.stageLabels} save={save} />
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
            </>
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
