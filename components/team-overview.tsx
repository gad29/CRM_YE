'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { PAYMENT_STATUS_LABELS, STAGE_LABELS, isUnderInvestigation, type CaseStage } from '@/lib/domain';

type WorkerRow = { id: string; name: string; email: string; active: boolean; openCases: number };
type CaseRow = {
  id: string;
  clientName: string;
  title: string;
  stage: CaseStage;
  missingItems: number;
  troubleFlag?: boolean;
  decisionStatus?: 'approved' | 'investigation';
  investigationOutcome?: 'approved' | 'rejected';
  openedBy?: string;
  assignedTo?: string;
  nextAction?: string;
  finance: { fee: number; paid: number; balance: number; status: 'paid' | 'partial' | 'unpaid' };
};

function shekel(amount: number) {
  return `₪${amount.toLocaleString('he-IL')}`;
}

/** Admin-only: pick an employee → see the cases they manage → open a case. */
export function TeamOverview() {
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/workers').then((r) => r.json()),
      fetch('/api/cases').then((r) => r.json()),
    ])
      .then(([w, c]) => {
        if (w.ok) setWorkers(w.data);
        if (c.ok) setCases(c.data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const workerCases = useMemo(() => {
    if (!selected) return [];
    return cases.filter((c) => c.assignedTo === selected || c.openedBy === selected);
  }, [cases, selected]);

  if (!loaded || workers.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="section-heading">
        <h3 style={{ margin: 0 }}>הצוות שלי</h3>
        <Link className="mini-link" href={'/workers' as never}>ניהול עובדים ←</Link>
      </div>

      <div className="team-chips">
        {workers.map((w) => (
          <button
            key={w.id}
            type="button"
            className={`team-chip ${selected === w.id ? 'active' : ''} ${!w.active ? 'inactive' : ''}`}
            onClick={() => setSelected((prev) => (prev === w.id ? '' : w.id))}
          >
            <span className="avatar avatar-sm avatar-soft">{w.name[0]}</span>
            <span>
              <strong style={{ display: 'block', fontSize: 13 }}>{w.name}</strong>
              <span className="muted" style={{ fontSize: 11 }}>{w.openCases} תיקים פעילים{!w.active ? ' · מושבת' : ''}</span>
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <div style={{ marginTop: 14 }}>
          {workerCases.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>אין תיקים משויכים לעובד זה.</p>
          ) : (
            <div className="office-case-list">
              {workerCases.map((c) => (
                <Link
                  key={c.id}
                  className={`case-list-item ${c.troubleFlag || isUnderInvestigation(c) ? 'case-trouble' : ''}`}
                  href={`/cases/${c.id}` as never}
                >
                  <span className="cli-name">
                    {c.troubleFlag && '🚩 '}
                    {isUnderInvestigation(c) && '🔍 '}
                    {c.clientName} · {c.title}
                  </span>
                  <span className="cli-stage">{STAGE_LABELS[c.stage]}</span>
                  <span className="cli-meta">
                    <span className="case-id-badge">{c.id}</span>
                    {c.missingItems > 0 && <span className="cli-missing">· {c.missingItems} מסמכים חסרים</span>}
                    <span>· {PAYMENT_STATUS_LABELS[c.finance.status]}{c.finance.balance > 0 && ` (${shekel(c.finance.balance)})`}</span>
                    {c.nextAction && <span>· ➜ {c.nextAction}</span>}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
