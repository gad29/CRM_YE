'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Empty, PageHead } from '@/components/ui/bits';
import { IconHistory, IconSearch } from '@/components/ui/icons';
import '@/app/styles/admin.css';

type Entry = { id: string; type: string; summary: string; at: string; clientId?: string; clientName?: string; caseId?: string };

const KINDS = [
  { value: '', label: 'הכול' },
  { value: 'cases', label: 'תיקים' },
  { value: 'clients', label: 'לקוחות' },
  { value: 'documents', label: 'מסמכים' },
  { value: 'payments', label: 'תשלומים' },
  { value: 'tasks', label: 'משימות' },
  { value: 'team', label: 'צוות וכניסות' },
  { value: 'settings', label: 'הגדרות' },
];

const PAGE = 80;

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'היום';
  if (d.toDateString() === yesterday.toDateString()) return 'אתמול';
  return d.toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

export default function ActivityPage() {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);

  const fetchPage = useCallback(async (before?: string) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (kind) params.set('kind', kind);
    if (before) params.set('before', before);
    const res = await fetch(`/api/activity?${params}`);
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error);
    return json.data as Entry[];
  }, [q, kind]);

  // New search or area: start over, debounced while typing.
  useEffect(() => {
    const mine = ++request.current;
    const t = setTimeout(async () => {
      setError('');
      try {
        const data = await fetchPage();
        if (mine !== request.current) return;
        setRows(data);
        setMore(data.length === PAGE);
      } catch {
        if (mine === request.current) setError('לא הצלחנו לטעון את היומן');
      }
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [fetchPage, q]);

  async function loadOlder() {
    if (!rows?.length) return;
    setBusy(true);
    try {
      const data = await fetchPage(rows[rows.length - 1].at);
      setRows((prev) => {
        const seen = new Set((prev ?? []).map((r) => r.id));
        return [...(prev ?? []), ...data.filter((r) => !seen.has(r.id))];
      });
      setMore(data.length === PAGE);
    } catch {
      setError('לא הצלחנו לטעון רשומות ישנות יותר');
    } finally {
      setBusy(false);
    }
  }

  // Group consecutive entries by day.
  const groups: { day: string; items: Entry[] }[] = [];
  for (const r of rows ?? []) {
    const day = dayLabel(r.at);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(r);
    else groups.push({ day, items: [r] });
  }

  return (
    <div className="page">
      <PageHead eyebrow="ניהול" title="יומן פעילות" sub="כל שינוי במערכת — מי, מה ומתי. נשמר גם אחרי שלקוח או תיק נמחקים." />

      <div className="card">
        <div className="row" style={{ marginBottom: 6 }}>
          <div className="search" style={{ maxWidth: 360 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש ביומן — שם, תיק, פעולה" aria-label="חיפוש ביומן" />
            <span style={{ position: 'absolute', insetInlineStart: 12, top: 11, color: 'var(--muted)', pointerEvents: 'none' }}>
              <IconSearch size={17} />
            </span>
          </div>
        </div>
        <div className="row" style={{ gap: 6, marginBottom: 4 }} role="radiogroup" aria-label="תחום">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={kind === k.value}
              className={`filter-chip ${kind === k.value ? 'on' : ''}`}
              onClick={() => setKind(k.value)}
            >
              {k.label}
            </button>
          ))}
        </div>

        {error && <p className="form-error" style={{ marginTop: 12 }}>{error}</p>}

        {!rows ? (
          <div className="stack" style={{ gap: 8, marginTop: 14 }}>
            {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 36 }} />)}
          </div>
        ) : !rows.length ? (
          <Empty icon={<IconHistory size={30} />} title={q || kind ? 'אין רשומות שמתאימות' : 'היומן עדיין ריק'}>
            {q || kind ? 'נסו מילה אחרת או תחום אחר.' : 'פעולות בתיקים, במסמכים ובצוות יופיעו כאן.'}
          </Empty>
        ) : (
          <div>
            {groups.map((g) => (
              <section key={g.day + g.items[0].id}>
                <div className="log-day">{g.day}</div>
                {g.items.map((r) => (
                  <div key={r.id} className="log-row">
                    <span className="log-time">{timeOf(r.at)}</span>
                    <span>{r.summary}</span>
                    <span className="log-links">
                      {r.clientId && r.clientName && (
                        <Link href={`/clients/${encodeURIComponent(r.clientId)}` as never} className="text-link">
                          {r.clientName}
                        </Link>
                      )}
                      {r.caseId && (
                        <Link href={`/cases/${encodeURIComponent(r.caseId)}` as never} className="text-link mono">
                          {r.caseId}
                        </Link>
                      )}
                    </span>
                  </div>
                ))}
              </section>
            ))}
            {more && (
              <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
                <button type="button" className="button button-secondary" disabled={busy} onClick={loadOlder}>
                  {busy ? 'טוען…' : 'רשומות ישנות יותר'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
