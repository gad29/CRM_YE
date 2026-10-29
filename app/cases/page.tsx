'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CASE_KIND_LABELS,
  CASE_STAGES,
  PAYMENT_STATUS_LABELS,
  stageLabelOf,
  isUnderInvestigation,
  type CaseKind,
  type CaseStage,
  type DecisionStatus,
  type GovernmentOffice,
  type InvestigationOutcome,
  type OperatingCompany,
} from '@/lib/domain';
import { useConfig } from '@/components/config-provider';
import { CompanyChip, useCompanyStripe } from '@/components/company-chip';

type CaseRow = {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  office: GovernmentOffice;
  officeName: string;
  stage: CaseStage;
  missingItems: number;
  nextAction?: string;
  openedAt: string;
  company?: OperatingCompany;
  caseKind?: CaseKind;
  troubleFlag?: boolean;
  decisionStatus?: DecisionStatus;
  investigationOutcome?: InvestigationOutcome;
  openedByName?: string;
  assignedToName?: string;
  finance: { fee: number; paid: number; balance: number; status: 'paid' | 'partial' | 'unpaid' };
};

type ClientOption = { id: string; fullName: string };

function shekel(amount: number) {
  return `₪${amount.toLocaleString('he-IL')}`;
}

const FILTERS = [
  { id: 'open', label: 'פעילים' },
  { id: 'payment', label: '💰 ממתינים לתשלום' },
  { id: 'trouble', label: '🚩 דורשים טיפול' },
  { id: 'stuck', label: 'חסרים מסמכים' },
  { id: 'waiting', label: 'ממתינים למשרד' },
  { id: 'closed', label: 'סגורים' },
  { id: 'all', label: 'הכל' },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

function NewCaseForm({
  clients,
  initialClientId,
  onClose,
  onCreated,
}: {
  clients: ClientOption[];
  initialClientId: string;
  onClose: () => void;
  onCreated: (caseId: string) => void;
}) {
  const config = useConfig();
  const [form, setForm] = useState({
    clientId: initialClientId,
    title: config.defaultCaseTitle,
    office: 'housing-ministry' as GovernmentOffice,
    officeOther: '',
    description: '',
    fee: config.defaultFee ? String(config.defaultFee) : '',
    nextAction: '',
    // No default — the company must be chosen explicitly.
    company: '' as OperatingCompany | '',
    caseKind: 'new' as CaseKind,
  });
  const [useChecklist, setUseChecklist] = useState(config.seedChecklistByDefault);
  const [checklistCodes, setChecklistCodes] = useState<string[]>(
    config.seedChecklistByDefault ? config.documentTemplates.map((t) => t.code) : [],
  );
  const [customItems, setCustomItems] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function toggleCode(code: string) {
    setChecklistCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  const suggested = config.documentTemplates;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          fee: form.fee ? Number(form.fee) : 0,
          checklistCodes: useChecklist ? checklistCodes : [],
          customChecklist: useChecklist ? customItems.split('\n').map((s) => s.trim()).filter(Boolean) : [],
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'פתיחת התיק נכשלה');
        return;
      }
      onCreated(data.data.id);
    } catch {
      setError('שגיאת תקשורת');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="section-heading">
        <h3 style={{ margin: 0 }}>פתיחת תיק חדש</h3>
        <button type="button" className="doc-action-btn" onClick={onClose}>✕ סגור</button>
      </div>
      <form onSubmit={submit}>
        <div className="form-grid cols-2">
          <div className="field">
            <label>לקוח *</label>
            <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} required>
              <option value="">בחר לקוח…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.fullName}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>נושא התיק *</label>
            <input
              placeholder='למשל: "קצבת נכות כללית"'
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label>חברה מטפלת *</label>
            <select
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value as OperatingCompany | '' })}
              required
            >
              <option value="" disabled>בחרו חברה…</option>
              {config.companies.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>סוג התיק</label>
            <div className="language-switch">
              {(Object.entries(CASE_KIND_LABELS) as [CaseKind, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`language-option ${form.caseKind === value ? 'active' : ''}`}
                  onClick={() => setForm({ ...form, caseKind: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>משרד ממשלתי</label>
            <select value={form.office} onChange={(e) => setForm({ ...form, office: e.target.value as GovernmentOffice })}>
              {config.offices.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {form.office === 'other' && (
            <div className="field">
              <label>שם המשרד</label>
              <input value={form.officeOther} onChange={(e) => setForm({ ...form, officeOther: e.target.value })} />
            </div>
          )}
          <div className="field">
            <label>שכר טרחה (₪)</label>
            <input type="number" min="0" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} />
          </div>
          <div className="field">
            <label>פעולה הבאה</label>
            <input value={form.nextAction} onChange={(e) => setForm({ ...form, nextAction: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>תיאור</label>
          <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>

        <div className="section-heading" style={{ marginTop: 6 }}>
          <label className="choice-card" style={{ display: 'inline-flex', width: 'auto', padding: '8px 14px' }}>
            <input type="checkbox" checked={useChecklist} onChange={(e) => setUseChecklist(e.target.checked)} />
            <span>טען רשימת מסמכים נדרשים לתיק</span>
          </label>
          {useChecklist && suggested.length > 0 && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="doc-action-btn" onClick={() => setChecklistCodes(suggested.map((t) => t.code))}>בחר הכל</button>
              <button type="button" className="doc-action-btn" onClick={() => setChecklistCodes([])}>נקה</button>
            </div>
          )}
        </div>

        {useChecklist ? (
          <>
            <div className="choice-grid" style={{ marginBottom: 14 }}>
              {suggested.map((template) => (
                <label key={template.code} className={`choice-card ${checklistCodes.includes(template.code) ? 'selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checklistCodes.includes(template.code)}
                    onChange={() => toggleCode(template.code)}
                  />
                  <span>{template.label}</span>
                </label>
              ))}
            </div>
            <div className="field">
              <label>מסמכים נוספים (שורה לכל מסמך)</label>
              <textarea
                rows={2}
                placeholder={'למשל:\nאישור רופא תעסוקתי\nצילום המחאה מבוטלת'}
                value={customItems}
                onChange={(e) => setCustomItems(e.target.value)}
              />
            </div>
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            התיק ייפתח ללא רשימת מסמכים — אפשר להעלות מסמכים בחופשיות מדף התיק.
          </p>
        )}

        {error && <p className="form-error">{error}</p>}
        <button className="button" type="submit" disabled={saving}>
          {saving ? 'פותח תיק…' : 'פתח תיק'}
        </button>
      </form>
    </div>
  );
}

const BOARD_STAGES: CaseStage[] = CASE_STAGES.filter((s) => s !== 'closed');

function KanbanBoard({ cases, onMove }: { cases: CaseRow[]; onMove: (caseId: string, stage: CaseStage) => void }) {
  const router = useRouter();
  const config = useConfig();
  const stripe = useCompanyStripe();
  const [dragOver, setDragOver] = useState<CaseStage | null>(null);

  return (
    <div className="kanban">
      {BOARD_STAGES.map((stage) => {
        const columnCases = cases.filter((c) => c.stage === stage);
        return (
          <div
            key={stage}
            className={`kanban-column ${dragOver === stage ? 'dragover' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(stage);
            }}
            onDragLeave={() => setDragOver((v) => (v === stage ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const caseId = e.dataTransfer.getData('text/case-id');
              if (caseId) onMove(caseId, stage);
            }}
          >
            <div className="kanban-column-header">
              <span>{stageLabelOf(config, stage)}</span>
              <span className="kanban-count">{columnCases.length}</span>
            </div>
            <div className="kanban-cards">
              {columnCases.map((c) => (
                <div
                  key={c.id}
                  {...stripe(c.company, `kanban-card ${c.troubleFlag || isUnderInvestigation(c) ? 'trouble' : ''}`)}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/case-id', c.id)}
                  onClick={() => router.push(`/cases/${c.id}` as never)}
                  title="לחיצה לפתיחה · גרירה לעמודה אחרת לעדכון השלב"
                >
                  <div className="kanban-card-title">
                    {c.troubleFlag && '🚩 '}
                    {isUnderInvestigation(c) && '🔍 '}
                    {c.clientName}
                  </div>
                  <div className="kanban-card-sub">
                    <span>{c.title}</span>
                    <CompanyChip company={c.company} />
                    {c.missingItems > 0 && <span className="cli-missing">· {c.missingItems} חסרים</span>}
                  </div>
                  {(c.assignedToName || c.openedByName) && (
                    <div className="kanban-card-sub">
                      <span className="kanban-worker">👤 {c.assignedToName || c.openedByName}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListViewIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function BoardViewIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="18" rx="1" /><rect x="14" y="3" width="7" height="12" rx="1" />
    </svg>
  );
}

function CasesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const config = useConfig();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const stripe = useCompanyStripe();
  const [filter, setFilter] = useState<FilterId>(() => {
    const wanted = searchParams.get('filter');
    return (FILTERS.find((f) => f.id === wanted)?.id ?? 'open') as FilterId;
  });
  const [view, setView] = useState<'list' | 'board'>('list');
  const [showNew, setShowNew] = useState(searchParams.get('new') === '1');

  async function moveCase(caseId: string, stage: CaseStage) {
    const existing = cases.find((c) => c.id === caseId);
    if (!existing || existing.stage === stage) return;
    // Optimistic update, then persist.
    setCases((prev) => prev.map((c) => (c.id === caseId ? { ...c, stage } : c)));
    const res = await fetch(`/api/cases/${caseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage }),
    });
    if (!res.ok) {
      setCases((prev) => prev.map((c) => (c.id === caseId ? { ...c, stage: existing.stage } : c)));
    }
  }

  useEffect(() => {
    Promise.all([
      fetch('/api/cases').then((r) => r.json()),
      fetch('/api/clients').then((r) => r.json()),
    ])
      .then(([casesRes, clientsRes]) => {
        if (casesRes.ok) setCases(casesRes.data);
        if (clientsRes.ok) setClients(clientsRes.data);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    switch (filter) {
      case 'open':
        return cases.filter((c) => c.stage !== 'closed');
      case 'payment':
        return cases.filter((c) => c.stage === 'awaiting-payment');
      case 'trouble':
        return cases.filter((c) => c.troubleFlag && c.stage !== 'closed');
      case 'stuck':
        return cases.filter((c) => c.stage !== 'closed' && (c.missingItems > 0 || c.stage === 'action-required'));
      case 'waiting':
        return cases.filter((c) => c.stage === 'submitted' || c.stage === 'in-government-review');
      case 'closed':
        return cases.filter((c) => c.stage === 'closed');
      default:
        return cases;
    }
  }, [cases, filter]);

  return (
    <div>
      <div className="hero">
        <div>
          <p className="eyebrow">תיקים</p>
          <h1 style={{ margin: '6px 0 4px' }}>כל התיקים</h1>
          <p className="muted" style={{ margin: 0 }}>{cases.filter((c) => c.stage !== 'closed').length} פעילים מתוך {cases.length}</p>
        </div>
        <div className="hero-actions">
          <button className="button" type="button" onClick={() => setShowNew(true)}>+ תיק חדש</button>
        </div>
      </div>

      {showNew && (
        <NewCaseForm
          clients={clients}
          initialClientId={searchParams.get('clientId') || ''}
          onClose={() => setShowNew(false)}
          onCreated={(caseId) => router.push(`/cases/${caseId}` as never)}
        />
      )}

      <div className="split" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div className="tab-bar" style={{ flex: 1, marginBottom: 22 }}>
          {FILTERS.map(({ id, label }) => (
            <button key={id} type="button" className={`tab ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="view-toggle">
          <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            <ListViewIcon /> רשימה
          </button>
          <button type="button" className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}>
            <BoardViewIcon /> לוח
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card muted" style={{ padding: 24 }}>טוען תיקים…</div>
      ) : view === 'board' ? (
        <KanbanBoard cases={cases.filter((c) => c.stage !== 'closed')} onMove={moveCase} />
      ) : filtered.length === 0 ? (
        <div className="card muted" style={{ padding: 24 }}>אין תיקים בסינון הנוכחי.</div>
      ) : (
        <div className="office-case-list">
          {filter === 'payment' && (
            <div className="muted" style={{ fontSize: 13 }}>
              {filtered.length} תיקים ממתינים לתשלום · יתרה לגבייה {shekel(filtered.reduce((sum, c) => sum + c.finance.balance, 0))}
            </div>
          )}
          {filtered.map((c) => (
            <Link
              key={c.id}
              {...stripe(c.company, `case-list-item ${c.troubleFlag || isUnderInvestigation(c) ? 'case-trouble' : ''}`)}
              href={`/cases/${c.id}` as never}
            >
              <span className="cli-name">
                {c.troubleFlag && '🚩 '}
                {isUnderInvestigation(c) && '🔍 '}
                {c.clientName} · {c.title}
                {c.caseKind === 'renewal' && <span className="kind-badge">חידוש</span>}
              </span>
              <span className="cli-stage">{stageLabelOf(config, c.stage)}</span>
              <span className="cli-meta">
                <span className="case-id-badge">{c.id}</span>
                <CompanyChip company={c.company} />
                {(!c.company || c.company === 'none') && <span>{c.officeName}</span>}
                {c.assignedToName && <span>· 👤 {c.assignedToName}</span>}
                {!c.assignedToName && c.openedByName && <span>· 👤 {c.openedByName}</span>}
                {c.missingItems > 0 && <span className="cli-missing">· {c.missingItems} מסמכים חסרים</span>}
                <span>
                  · {PAYMENT_STATUS_LABELS[c.finance.status]}
                  {c.finance.balance > 0 && ` (${shekel(c.finance.balance)})`}
                </span>
                {c.nextAction && <span>· ➜ {c.nextAction}</span>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CasesPage() {
  return (
    <Suspense>
      <CasesPageInner />
    </Suspense>
  );
}
