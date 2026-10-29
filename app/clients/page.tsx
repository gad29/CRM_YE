'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useNewFlow } from '@/components/app-shell';
import { Empty, PageHead, Segmented, shekel } from '@/components/ui/bits';
import { IconChevronLeft, IconClients, IconFlag, IconPlus, IconSearch, IconX } from '@/components/ui/icons';
import { letters } from './letters';
import '../styles/lists.css';

type ClientRow = {
  id: string;
  fullName: string;
  phone: string;
  idNumber?: string;
  email?: string;
  city?: string;
  caseCount: number;
  openCaseCount: number;
  missingItems: number;
  hasTrouble?: boolean;
  outstandingBalance: number;
  createdAt: string;
  updatedAt?: string;
};

type Chip = 'all' | 'active' | 'missing' | 'balance' | 'flagged' | 'nocase' | 'dupes';

const CHIPS: { id: Chip; label: string }[] = [
  { id: 'all', label: 'כולם' },
  { id: 'active', label: 'עם תיק פעיל' },
  { id: 'missing', label: 'חסרים מסמכים' },
  { id: 'balance', label: 'יתרה לתשלום' },
  { id: 'flagged', label: 'מסומנים' },
  { id: 'nocase', label: 'בלי תיק פעיל' },
  { id: 'dupes', label: 'כפילויות אפשריות' },
];

const digits = (v?: string) => (v || '').replace(/\D/g, '');


function ClientsInner() {
  const params = useSearchParams();
  const openWizard = useNewFlow();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState(params.get('q') || '');
  const [chip, setChip] = useState<Chip>(() => (CHIPS.some((c) => c.id === params.get('show')) ? (params.get('show') as Chip) : 'all'));
  const [sort, setSort] = useState<'name' | 'recent'>('recent');

  useEffect(() => {
    fetch('/api/clients')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setClients(d.data);
        else setFailed(true);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  // Old links: /clients?new=1 open the new-client flow.
  useEffect(() => {
    if (params.get('new') === '1') openWizard({ mode: 'client' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Two cards for one person (same phone or ID number) — flagged so they can be merged by hand.
  const dupes = useMemo(() => {
    const seen = new Map<string, string[]>();
    for (const c of clients) {
      for (const key of [digits(c.phone).slice(-9), digits(c.idNumber).replace(/^0+/, '')]) {
        if (key.length < 7) continue;
        seen.set(key, [...(seen.get(key) ?? []), c.id]);
      }
    }
    const ids = new Set<string>();
    for (const list of seen.values()) if (list.length > 1) list.forEach((id) => ids.add(id));
    return ids;
  }, [clients]);

  const matchesChip = (c: ClientRow, id: Chip) => {
    switch (id) {
      case 'active':
        return c.openCaseCount > 0;
      case 'missing':
        return c.missingItems > 0;
      case 'balance':
        return c.outstandingBalance > 0;
      case 'flagged':
        return Boolean(c.hasTrouble);
      case 'nocase':
        return c.openCaseCount === 0;
      case 'dupes':
        return dupes.has(c.id);
      default:
        return true;
    }
  };

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = digits(q);
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.fullName.toLowerCase().includes(q) ||
        (qDigits.length >= 3 && (digits(c.phone).includes(qDigits) || digits(c.idNumber).includes(qDigits))) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.city || '').toLowerCase().includes(q) ||
        c.id.toLowerCase() === q,
    );
  }, [clients, query]);

  const shown = useMemo(() => {
    const list = searched.filter((c) => matchesChip(c, chip));
    return list.sort((a, b) =>
      sort === 'name'
        ? a.fullName.localeCompare(b.fullName, 'he')
        : (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, chip, sort, dupes]);

  const chips = CHIPS.filter((c) => c.id !== 'dupes' || dupes.size > 0);

  return (
    <div>
      <PageHead
        eyebrow="לקוחות"
        title="הלקוחות"
        sub={loading ? 'טוען…' : `${clients.length} לקוחות · ${clients.filter((c) => c.openCaseCount > 0).length} עם תיק פעיל`}
        actions={
          <button type="button" className="button" onClick={() => openWizard({ mode: 'client' })}>
            <IconPlus size={16} /> לקוח חדש
          </button>
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
              placeholder="שם, טלפון, תעודת זהות, אימייל או עיר"
              aria-label="חיפוש לקוחות"
              autoFocus
            />
          </label>
          <Segmented
            label="מיון"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'recent', label: 'עודכנו לאחרונה' },
              { value: 'name', label: 'א–ת' },
            ]}
          />
        </div>
        <div className="filters-row scroll" role="group" aria-label="סינון לקוחות">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`filter-chip ${chip === c.id ? 'on' : ''}`}
              aria-pressed={chip === c.id}
              onClick={() => setChip(c.id)}
            >
              {c.label}
              {!loading && <span className="n">{searched.filter((x) => matchesChip(x, c.id)).length}</span>}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="card" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton" style={{ height: 44, margin: '8px 0', borderRadius: 10 }} />
          ))}
        </div>
      ) : failed ? (
        <Empty icon={<IconClients size={30} />} title="הרשימה לא נטענה">
          בדקו את החיבור לאינטרנט ורעננו את הדף.
        </Empty>
      ) : clients.length === 0 ? (
        <Empty
          icon={<IconClients size={30} />}
          title="עוד אין לקוחות"
          action={
            <button type="button" className="button" onClick={() => openWizard({ mode: 'client' })}>
              <IconPlus size={16} /> הלקוח הראשון
            </button>
          }
        >
          פרטי הלקוח, החברה המטפלת ורשימת המסמכים — בשלושה צעדים, והתיק נפתח.
        </Empty>
      ) : shown.length === 0 ? (
        <Empty icon={<IconSearch size={28} />} title="לא נמצאו לקוחות">
          {query ? (
            <span>
              אין התאמה ל״{query}״.{' '}
              <button type="button" className="text-link" onClick={() => { setQuery(''); setChip('all'); }}>
                ניקוי החיפוש
              </button>
            </span>
          ) : (
            'אין לקוחות בסינון הזה.'
          )}
        </Empty>
      ) : (
        <div className="card client-list">
          {shown.map((c) => (
            <Link key={c.id} href={`/clients/${c.id}` as never} className="list-row client-row">
              <span className={`avatar ${c.hasTrouble ? 'flag' : ''}`}>{letters(c.fullName)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="list-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="truncate">{c.fullName}</span>
                  {c.hasTrouble && <IconFlag size={13} style={{ color: 'var(--red)', flexShrink: 0 }} aria-label="יש תיק מסומן" />}
                  {dupes.has(c.id) && <span className="chip amber" title="טלפון או תעודת זהות זהים ללקוח אחר">כפילות?</span>}
                </span>
                <span className="list-sub client-meta">
                  <span className="ltr">{c.phone}</span>
                  {c.idNumber && <span>ת״ז <span className="ltr">{c.idNumber}</span></span>}
                  {c.city && <span>{c.city}</span>}
                </span>
              </span>
              <span className="client-stats">
                <span className="hide-sm tiny muted">
                  {c.openCaseCount > 0 ? `${c.openCaseCount} ${c.openCaseCount === 1 ? 'תיק פעיל' : 'תיקים פעילים'}` : c.caseCount > 0 ? 'תיקים סגורים' : 'בלי תיק'}
                </span>
                {c.missingItems > 0 && <span className="stamp missing">{c.missingItems} חסרים</span>}
                {c.outstandingBalance > 0 && <span className="chip amber num hide-sm">{shekel(c.outstandingBalance)}</span>}
              </span>
              <IconChevronLeft size={16} className="muted" />
            </Link>
          ))}
        </div>
      )}
      {(query || chip !== 'all') && shown.length > 0 && (
        <div className="list-foot">
          {shown.length} מתוך {clients.length}
          <button type="button" className="text-link" onClick={() => { setQuery(''); setChip('all'); }}>
            <IconX size={13} /> הצגת כולם
          </button>
        </div>
      )}
    </div>
  );
}

export default function ClientsPage() {
  return (
    <Suspense>
      <ClientsInner />
    </Suspense>
  );
}
