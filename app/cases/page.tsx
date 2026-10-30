'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  PAYMENT_STATUS_LABELS,
  companyColor,
  isUnderInvestigation,
  optionLabel,
  stageLabelOf,
  type AppConfig,
  type CaseKind,
  type CaseStage,
  type DecisionStatus,
  type InvestigationOutcome,
  type OperatingCompany,
} from '@/lib/domain';
import { useConfig, useText } from '@/components/config-provider';
import { formatFieldValue } from '@/components/field-input';
import { useSession } from '@/components/session-provider';
import { useNewFlow } from '@/components/app-shell';
import { useToast } from '@/components/ui/toast';
import { Modal } from '@/components/ui/overlay';
import { Empty, PageHead, Segmented, shekel } from '@/components/ui/bits';
import { IconBoard, IconChevronLeft, IconFlag, IconFolder, IconList, IconPlus, IconSearch, IconX } from '@/components/ui/icons';
import { boardStages, inTray, phaseOfCase, phasesOf, trayDef, traysOf, type PhaseId, type TrayId } from '@/components/case-trays';
import '../styles/lists.css';

type CaseRow = {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  officeName: string;
  stage: CaseStage;
  missingItems: number;
  nextAction?: string;
  openedAt: string;
  updatedAt: string;
  company?: OperatingCompany;
  caseKind?: CaseKind;
  troubleFlag?: boolean;
  troubleNote?: string;
  decisionStatus?: DecisionStatus;
  investigationOutcome?: InvestigationOutcome;
  openedByName?: string;
  assignedToName?: string;
  handlerId?: string;
  finance: { fee: number; paid: number; balance: number; status: 'paid' | 'partial' | 'unpaid' };
  extra?: Record<string, string>;
};

type Scope = 'open' | TrayId | 'closed' | 'all';

const TRAY_IDS: TrayId[] = ['missing', 'ready', 'office', 'payment', 'flagged'];

/** The status chips: active, the trays shown on Today (named as in Settings), closed, all. */
function scopesOf(config: AppConfig): { id: Scope; label: string }[] {
  return [
    { id: 'open', label: 'פעילים' },
    ...traysOf(config).map((t) => ({ id: t.id as Scope, label: t.label })),
    { id: 'closed', label: 'סגורים' },
    { id: 'all', label: 'הכול' },
  ];
}

/** Links from the old screens (?filter=…) keep working. */
const LEGACY_FILTER: Record<string, Scope> = { payment: 'payment', trouble: 'flagged', stuck: 'missing', waiting: 'office', open: 'open', closed: 'closed', all: 'all' };

const VIEW_KEY = 'crmye-cases-view';

function inScope(c: CaseRow, scope: Scope, config: AppConfig) {
  if (scope === 'all') return true;
  if (scope === 'open') return c.stage !== 'closed';
  if (scope === 'closed') return c.stage === 'closed';
  return inTray(c, scope, config);
}

function isFlagged(c: CaseRow) {
  return Boolean(c.troubleFlag) || isUnderInvestigation(c);
}

function handlerName(c: CaseRow, people?: Map<string, string>) {
  return (c.handlerId && people?.get(c.handlerId)) || c.assignedToName || c.openedByName || '';
}

function CasesInner() {
  const params = useSearchParams();
  const config = useConfig();
  const t = useText();
  const { me } = useSession();
  const toast = useToast();
  const openWizard = useNewFlow();
  const isAdmin = Boolean(me?.isAdmin);
  const scopes = scopesOf(config);
  const phases = phasesOf(config);

  const [cases, setCases] = useState<CaseRow[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<'list' | 'board'>('list');
  const [pickClient, setPickClient] = useState(false);

  const [scope, setScope] = useState<Scope>(() => {
    const tray = params.get('tray');
    // Any tray works from a link, even one hidden from Today.
    if (tray && (TRAY_IDS.includes(tray as TrayId) || ['open', 'closed', 'all'].includes(tray))) return tray as Scope;
    return LEGACY_FILTER[params.get('filter') || ''] ?? 'open';
  });
  const [phase, setPhase] = useState<PhaseId | ''>(() => (phasesOf(undefined).some((p) => p.id === params.get('phase')) ? (params.get('phase') as PhaseId) : ''));
  const [stage, setStage] = useState<CaseStage | ''>(() => params.get('stage') || '');
  const [company, setCompany] = useState(params.get('company') || '');
  const [handler, setHandler] = useState(params.get('handler') || '');
  const [query, setQuery] = useState(params.get('q') || '');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === 'board' || saved === 'list') setView(saved);
    } catch {
      /* private mode: list view */
    }
  }, []);

  function chooseView(next: 'list' | 'board') {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* not remembered, that's fine */
    }
  }

  // Old links: /cases?new=1[&clientId=…] open the new-case flow.
  useEffect(() => {
    if (params.get('new') !== '1') return;
    const clientId = params.get('clientId');
    if (!clientId) {
      setPickClient(true);
      return;
    }
    fetch(`/api/clients/${clientId}`)
      .then((r) => r.json())
      .then((d) => d.ok && openWizard({ mode: 'case', clientId, clientName: d.data.client.fullName }))
      .catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch('/api/cases')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setCases(d.data);
        else setFailed(true);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    fetch('/api/users')
      .then((r) => r.json())
      .then((d) => d.ok && setPeople(d.data.map((u: { id: string; name: string }) => ({ id: u.id, name: u.name }))))
      .catch(() => null);
  }, [isAdmin]);

  // Keep the address bar in step with the filters, so a filtered list can be shared or bookmarked.
  useEffect(() => {
    const q = new URLSearchParams();
    if (scope !== 'open') q.set('tray', scope);
    if (phase) q.set('phase', phase);
    if (stage) q.set('stage', stage);
    if (company) q.set('company', company);
    if (handler) q.set('handler', handler);
    if (query.trim()) q.set('q', query.trim());
    const next = q.toString() ? `/cases?${q}` : '/cases';
    if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(null, '', next);
  }, [scope, phase, stage, company, handler, query]);

  const byOthers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cases.filter((c) => {
      if (company && (c.company || 'none') !== company) return false;
      if (handler && c.handlerId !== handler) return false;
      if (q && ![c.clientName, c.title, c.id, c.officeName, handlerName(c)].some((v) => (v || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [cases, company, handler, query]);

  const scoped = useMemo(() => byOthers.filter((c) => inScope(c, scope, config)), [byOthers, scope, config]);

  const filtered = useMemo(
    () =>
      scoped
        .filter((c) => (!phase || phaseOfCase(config, c.stage) === phase) && (!stage || c.stage === stage))
        .sort((a, b) => Number(isFlagged(b)) - Number(isFlagged(a)) || b.updatedAt.localeCompare(a.updatedAt)),
    [scoped, phase, stage, config],
  );

  const scopeCount = (s: Scope) => byOthers.filter((c) => inScope(c, s, config)).length;
  const phaseCount = (p: PhaseId) => scoped.filter((c) => phaseOfCase(config, c.stage) === p).length;
  // A phase's stage pills: the shown stages, plus a hidden one that still holds cases.
  const phaseStages = (p: PhaseId) => boardStages(config, scoped.map((c) => c.stage)).filter((s) => s.phase === p);
  const companies = config.companies.filter((co) => cases.some((c) => (c.company || 'none') === co.value));
  const handlerOptions = useMemo(() => {
    const ids = new Set(cases.map((c) => c.handlerId).filter(Boolean) as string[]);
    const known = people.filter((p) => ids.has(p.id));
    for (const id of ids) {
      if (!known.some((p) => p.id === id)) {
        const c = cases.find((x) => x.handlerId === id);
        known.push({ id, name: (c && handlerName(c)) || id });
      }
    }
    return known.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }, [cases, people]);

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);

  const anyNarrowing = Boolean(phase || stage || company || handler || query.trim());
  function clearAll() {
    setPhase('');
    setStage('');
    setCompany('');
    setHandler('');
    setQuery('');
  }

  async function moveCase(caseId: string, to: CaseStage) {
    const existing = cases.find((c) => c.id === caseId);
    if (!existing || existing.stage === to) return;
    setCases((prev) => prev.map((c) => (c.id === caseId ? { ...c, stage: to } : c)));
    const res = await fetch(`/api/cases/${caseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: to }),
    }).catch(() => null);
    if (!res?.ok) {
      setCases((prev) => prev.map((c) => (c.id === caseId ? { ...c, stage: existing.stage } : c)));
      toast('העברת השלב נכשלה', 'error');
      return;
    }
    toast(`${existing.clientName}: ${stageLabelOf(config, to)}`);
  }

  const scopeLabel = scopes.find((s) => s.id === scope)?.label ?? trayDef(config, scope as TrayId)?.label ?? '';
  const balance = (view === 'board' ? scoped : filtered).reduce((sum, c) => sum + c.finance.balance, 0);

  return (
    <div>
      <PageHead
        eyebrow="תיקים"
        title={scope === 'open' ? 'תיקים פעילים' : scope === 'all' ? 'כל התיקים' : scopeLabel}
        sub={
          loading
            ? 'טוען…'
            : `${(view === 'board' ? scoped : filtered).length} תיקים${scope === 'payment' && config.modules.payments && balance > 0 ? ` · יתרה לגבייה ${shekel(balance)}` : ''}`
        }
        actions={
          <>
            <Segmented
              label="תצוגה"
              value={view}
              onChange={chooseView}
              options={[
                { value: 'list', label: <><IconList size={15} /> רשימה</> },
                { value: 'board', label: <><IconBoard size={15} /> לוח</> },
              ]}
            />
            <button type="button" className="button" onClick={() => setPickClient(true)}>
              <IconPlus size={16} /> {t('btn.newCase')}
            </button>
          </>
        }
      />

      <div className="filters">
        <div className="filters-row">
          <label className="search filters-search">
            <IconSearch size={16} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש לפי לקוח, נושא או מספר תיק"
              aria-label="חיפוש תיקים"
            />
          </label>
          {companies.length > 1 &&
            companies.map((co) => {
              const color = companyColor(config, co.value);
              return (
                <button
                  key={co.value}
                  type="button"
                  className={`filter-chip ${company === co.value ? 'on' : ''}`}
                  style={color ? ({ '--co': color } as CSSProperties) : undefined}
                  aria-pressed={company === co.value}
                  onClick={() => setCompany((v) => (v === co.value ? '' : co.value))}
                >
                  {color && <span className="swatch" />}
                  {co.label}
                </button>
              );
            })}
          {isAdmin && handlerOptions.length > 1 && (
            <select className="filters-select" value={handler} onChange={(e) => setHandler(e.target.value)} aria-label="מטפל">
              <option value="">כל המטפלים</option>
              {handlerOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          {anyNarrowing && (
            <button type="button" className="button button-quiet button-compact" onClick={clearAll}>
              <IconX size={14} /> ניקוי סינון
            </button>
          )}
        </div>

        <div className="filters-row scroll" role="group" aria-label="מצב התיק">
          {scopes.map((s) => {
            const n = scopeCount(s.id);
            return (
              <button
                key={s.id}
                type="button"
                className={`filter-chip ${scope === s.id ? 'on' : ''}`}
                aria-pressed={scope === s.id}
                onClick={() => setScope(s.id)}
              >
                {s.label}
                {!loading && <span className="n">{n}</span>}
              </button>
            );
          })}
        </div>

        {view === 'list' && (
          <div className="phase-filter" role="group" aria-label="שלב">
            <button type="button" className={`phase-pill ${!phase ? 'on' : ''}`} onClick={() => { setPhase(''); setStage(''); }}>
              כל השלבים
            </button>
            {phases.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`phase-pill ${phase === p.id ? 'on' : ''}`}
                onClick={() => {
                  setPhase((v) => (v === p.id ? '' : p.id));
                  setStage('');
                }}
              >
                {p.label}
                <span className="n">{phaseCount(p.id)}</span>
              </button>
            ))}
          </div>
        )}
        {view === 'list' && phase && (
          <div className="stage-filter">
            {phaseStages(phase).map(({ code: s, label }) => (
              <button key={s} type="button" className={`stage-pill ${stage === s ? 'on' : ''}`} onClick={() => setStage((v) => (v === s ? '' : s))}>
                {label}
                <span className="n">{scoped.filter((c) => c.stage === s).length}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="stack" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 64, borderRadius: 12 }} />
          ))}
        </div>
      ) : failed ? (
        <Empty icon={<IconFolder size={30} />} title="הרשימה לא נטענה">
          בדקו את החיבור לאינטרנט ורעננו את הדף.
        </Empty>
      ) : view === 'board' ? (
        <Board cases={scoped} showClosed={scope === 'closed' || scope === 'all'} onMove={moveCase} people={peopleById} />
      ) : filtered.length === 0 ? (
        cases.length === 0 ? (
          <Empty
            icon={<IconFolder size={30} />}
            title="עוד אין תיקים"
            action={
              <button type="button" className="button" onClick={() => openWizard({ mode: 'client' })}>
                <IconPlus size={16} /> לקוח ותיק ראשונים
              </button>
            }
          >
            תיק נפתח יחד עם לקוח חדש, או מדף של לקוח קיים.
          </Empty>
        ) : (
          <Empty icon={<IconSearch size={28} />} title="אין תיקים שמתאימים לסינון">
            {anyNarrowing ? (
              <button type="button" className="text-link" onClick={clearAll}>ניקוי הסינון</button>
            ) : (
              'נסו מצב אחר מהשורה למעלה.'
            )}
          </Empty>
        )
      ) : (
        <div className="case-list">
          {filtered.map((c) => (
            <CaseLine key={c.id} c={c} showHandler={isAdmin} handler={handlerName(c, peopleById)} />
          ))}
        </div>
      )}

      {pickClient && (
        <ClientPicker
          onClose={() => setPickClient(false)}
          onPick={(client) => {
            setPickClient(false);
            if (client) openWizard({ mode: 'case', clientId: client.id, clientName: client.fullName });
            else openWizard({ mode: 'client' });
          }}
        />
      )}
    </div>
  );
}

function CaseLine({ c, showHandler, handler }: { c: CaseRow; showHandler: boolean; handler: string }) {
  const config = useConfig();
  const color = companyColor(config, c.company);
  const flagged = isFlagged(c);
  const shown = (key: string) => config.caseFields.find((f) => f.key === key)?.visible !== false;
  // Fields added in Settings and marked "show in lists".
  const listed = config.caseFields
    .filter((f) => !f.builtIn && f.visible && f.inList)
    .map((f) => ({ key: f.key, label: f.label, value: formatFieldValue(f, c) }))
    .filter((f) => f.value);
  return (
    <Link
      href={`/cases/${c.id}` as never}
      className={`case-row ${flagged ? 'flagged' : ''}`}
      style={color ? ({ '--co': color } as CSSProperties) : undefined}
    >
      <span style={{ minWidth: 0 }}>
        <span className="who truncate" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {flagged && <IconFlag size={14} style={{ color: 'var(--red)', flexShrink: 0 }} aria-label="מסומן" />}
          <span className="truncate">{c.clientName}</span>
        </span>
        <span className="what" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="truncate">{c.title}</span>
          {shown('company') && c.company && c.company !== 'none' && (
            <span className="co-name" style={{ color: color || undefined }}>{optionLabel(config.companies, c.company, '')}</span>
          )}
          {shown('caseKind') && c.caseKind === 'renewal' && <span className="chip">חידוש</span>}
          {listed.map((f) => (
            <span key={f.key} className="tiny muted case-extra">
              {f.label}: {f.value}
            </span>
          ))}
          <span className="mono tiny muted">{c.id}</span>
        </span>
      </span>
      <span style={{ minWidth: 0 }}>
        <span className="case-stage">{stageLabelOf(config, c.stage)}</span>
        {(c.troubleNote && flagged) || c.nextAction ? (
          <span className="what truncate" style={{ display: 'block' }}>{flagged && c.troubleNote ? c.troubleNote : c.nextAction}</span>
        ) : null}
      </span>
      <span className="hide-sm what truncate">{showHandler ? handler || '—' : shown('office') ? c.officeName : ''}</span>
      <span className="hide-sm what">
        {config.modules.payments && (
          <>
            <span className={`pay pay-${c.finance.status}`}>{PAYMENT_STATUS_LABELS[c.finance.status]}</span>
            {c.finance.balance > 0 && <span className="num"> · {shekel(c.finance.balance)}</span>}
          </>
        )}
      </span>
      <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
        {c.missingItems > 0 && c.stage !== 'closed' && <span className="stamp missing">{c.missingItems} חסרים</span>}
        <IconChevronLeft size={16} className="muted" />
      </span>
    </Link>
  );
}

function Board({ cases, showClosed, onMove, people }: { cases: CaseRow[]; showClosed: boolean; onMove: (id: string, stage: CaseStage) => void; people: Map<string, string> }) {
  const config = useConfig();
  const router = useRouter();
  const [over, setOver] = useState<CaseStage | null>(null);
  const stages = boardStages(config, cases.map((c) => c.stage))
    .map((st) => st.code)
    .filter((s) => showClosed || s !== 'closed');
  const companyShown = config.caseFields.find((f) => f.key === 'company')?.visible !== false;
  return (
    <div className="board">
      {stages.map((s) => {
        const col = cases.filter((c) => c.stage === s);
        return (
          <div
            key={s}
            className={`board-col ${over === s ? 'over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(s);
            }}
            onDragLeave={() => setOver((v) => (v === s ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData('text/case-id');
              if (id) onMove(id, s);
            }}
          >
            <div className="board-col-head">
              <span>{stageLabelOf(config, s)}</span>
              <span className="muted num">{col.length}</span>
            </div>
            {col.map((c) => {
              const color = companyColor(config, c.company);
              return (
                <div
                  key={c.id}
                  className={`folder ${isFlagged(c) ? 'flagged' : ''}`}
                  style={color ? ({ '--co': color } as CSSProperties) : undefined}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/case-id', c.id)}
                  onClick={() => router.push(`/cases/${c.id}` as never)}
                  onKeyDown={(e) => e.key === 'Enter' && router.push(`/cases/${c.id}` as never)}
                  role="link"
                  tabIndex={0}
                  title="לחיצה פותחת את התיק · גרירה לעמודה אחרת מעבירה שלב"
                >
                  {companyShown && (
                    <span className={`folder-tab ${color ? '' : 'none'}`}>
                      {c.company && c.company !== 'none' ? optionLabel(config.companies, c.company, '') : 'ללא חברה'}
                    </span>
                  )}
                  <div className="folder-title truncate">
                    {isFlagged(c) && <IconFlag size={13} style={{ color: 'var(--red)', marginInlineEnd: 4, verticalAlign: -2 }} />}
                    {c.clientName}
                  </div>
                  <div className="folder-meta">
                    <span className="truncate">{c.title}</span>
                  </div>
                  <div className="folder-foot">
                    <span className="tiny muted">{handlerName(c, people)}</span>
                    {c.missingItems > 0 && <span className="stamp missing">{c.missingItems} חסרים</span>}
                  </div>
                </div>
              );
            })}
            {col.length === 0 && <div className="board-empty">אפשר לגרור לכאן</div>}
          </div>
        );
      })}
    </div>
  );
}

type ClientOption = { id: string; fullName: string; phone: string; idNumber?: string; openCaseCount: number };

/** "תיק חדש" from the cases list: pick the client first (or start a new one). */
function ClientPicker({ onClose, onPick }: { onClose: () => void; onPick: (client: ClientOption | null) => void }) {
  const [clients, setClients] = useState<ClientOption[] | null>(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => {
    fetch('/api/clients')
      .then((r) => r.json())
      .then((d) => setClients(d.ok ? d.data : []))
      .catch(() => setClients([]));
  }, []);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = clients ?? [];
    const found = s
      ? list.filter((c) => c.fullName.toLowerCase().includes(s) || c.phone.includes(s) || (c.idNumber || '').includes(s))
      : list;
    return found.slice(0, 8);
  }, [clients, q]);
  useEffect(() => setActive(0), [q]);

  return (
    <Modal title="תיק חדש" subtitle="לאיזה לקוח נפתח את התיק?" onClose={onClose} size="narrow">
      <div className="stack" style={{ gap: 12 }}>
        <label className="search">
          <IconSearch size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="שם, טלפון או תעודת זהות"
            aria-label="חיפוש לקוח"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, hits.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter' && hits[active]) {
                e.preventDefault();
                onPick(hits[active]);
              }
            }}
          />
        </label>
        {clients === null ? (
          <div className="skeleton" style={{ height: 120, borderRadius: 12 }} />
        ) : hits.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>{q ? 'לא נמצא לקוח כזה.' : 'אין עדיין לקוחות.'}</p>
        ) : (
          <div className="list picker-list" role="listbox" aria-label="לקוחות">
            {hits.map((c, i) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={i === active}
                className={`list-row picker-row ${i === active ? 'active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(c)}
              >
                <span className="avatar">{c.fullName.trim().slice(0, 1)}</span>
                <span style={{ flex: 1, minWidth: 0, textAlign: 'start' }}>
                  <span className="list-title" style={{ display: 'block' }}>{c.fullName}</span>
                  <span className="list-sub ltr" style={{ display: 'inline-block' }}>{c.phone}</span>
                </span>
                <span className="tiny muted">{c.openCaseCount > 0 ? `${c.openCaseCount} תיקים פעילים` : 'אין תיק פעיל'}</span>
              </button>
            ))}
          </div>
        )}
        <button type="button" className="button button-secondary" onClick={() => onPick(null)}>
          <IconPlus size={16} /> זה לקוח חדש
        </button>
      </div>
    </Modal>
  );
}

export default function CasesPage() {
  return (
    <Suspense>
      <CasesInner />
    </Suspense>
  );
}
