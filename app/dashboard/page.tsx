import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  countMissingItems,
  officeDisplayName,
  optionLabel,
  stageLabelOf,
  TASK_PRIORITY_LABELS,
  type CaseStage,
  type TaskPriority,
} from '@/lib/domain';
import { getCurrentSession } from '@/lib/admin-session';
import {
  assigneeContact,
  caseVisibleTo,
  getCaseFinance,
  getConfig,
  getDashboardSummary,
  listActivity,
  listClients,
  listPayments,
  listVisibleCases,
  listVisibleTasks,
} from '@/lib/store';
import { sessionToViewer } from '@/lib/viewer';
import { AnimatedNumber, CollectionDonut } from '@/components/animated-number';
import { TeamOverview } from '@/components/team-overview';

export const dynamic = 'force-dynamic';

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function FileWarnIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="12" x2="12" y2="15" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

function CoinsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function shekel(amount: number) {
  return `₪${amount.toLocaleString('he-IL')}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default async function DashboardPage() {
  const session = await getCurrentSession();
  // Middleware already guards this page; never fall back to an admin view.
  if (!session) redirect('/login');
  const viewer = sessionToViewer(session);
  const isAdmin = viewer.role === 'admin';
  const config = await getConfig();

  const summary = await getDashboardSummary(isAdmin ? undefined : (c) => caseVisibleTo(c, viewer));
  const clients = await listClients();
  const payments = await listPayments();
  const cases = await listVisibleCases(viewer);
  const clientIds = new Set(cases.map((c) => c.clientId));
  const activity = (await listActivity({ limit: 40 })).filter(
    (entry) => isAdmin || (entry.clientId && clientIds.has(entry.clientId)),
  ).slice(0, 12);

  const attention = cases
    .filter((c) => c.stage !== 'closed' && (c.troubleFlag || countMissingItems(c) > 0 || c.stage === 'action-required'))
    .sort((a, b) => Number(Boolean(b.troubleFlag)) - Number(Boolean(a.troubleFlag)))
    .slice(0, 8)
    .map((c) => ({
      ...c,
      clientName: clients.find((cl) => cl.id === c.clientId)?.fullName || '',
      missing: countMissingItems(c),
    }));

  const unpaidClosed = isAdmin
    ? cases
        .filter((c) => c.stage === 'closed')
        .map((c) => ({ ...c, finance: getCaseFinance(c, payments), clientName: clients.find((cl) => cl.id === c.clientId)?.fullName || '' }))
        .filter((c) => c.finance.balance > 0)
        .slice(0, 5)
    : [];

  const awaitingPayment = cases.filter((c) => c.stage === 'awaiting-payment');
  const awaitingPaymentBalance = awaitingPayment.reduce((sum, c) => sum + getCaseFinance(c, payments).balance, 0);

  const stageOrder = Object.keys(config.stageLabels) as CaseStage[];

  const priorityOrder: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2 };
  const openTaskRecords = (await listVisibleTasks(viewer))
    .filter((t) => t.status === 'open')
    .sort((a, b) => {
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) return priorityOrder[a.priority] - priorityOrder[b.priority];
      return (a.dueAt || '9999').localeCompare(b.dueAt || '9999');
    })
    .slice(0, 6);
  const openTasks = await Promise.all(
    openTaskRecords.map(async (t) => ({ ...t, assigneeName: (await assigneeContact(t.assigneeId)).name })),
  );

  return (
    <div>
      <div className="hero">
        <div>
          <p className="eyebrow">לוח בקרה</p>
          <h1 style={{ margin: '6px 0 4px' }}>שלום{session?.name ? ` ${session.name}` : ''} 👋</h1>
          <p className="muted" style={{ margin: 0 }}>
            {isAdmin ? 'תמונת מצב של כל הלקוחות והתיקים.' : 'התיקים והלקוחות שלך.'}
          </p>
        </div>
        <div className="hero-actions">
          <Link className="button" href={'/clients?new=1' as never}>+ לקוח חדש</Link>
          <Link className="button button-secondary" href={'/cases?new=1' as never}>+ תיק חדש</Link>
        </div>
      </div>

      <div className="pipeline-cards" style={{ marginBottom: 20 }}>
        <div className="pipeline-card pc-active">
          <div className="pc-label"><span className="kpi-icon"><FolderIcon /></span> תיקים פעילים</div>
          <div className="pc-count"><AnimatedNumber value={summary.openCases} /></div>
          <div className="muted" style={{ fontSize: 12 }}>מתוך {summary.cases} תיקים · {summary.clients} לקוחות</div>
        </div>
        <Link className="pipeline-card pc-payment" href={'/cases?filter=payment' as never} title="לרשימת התיקים הממתינים לתשלום">
          <div className="pc-label"><span className="kpi-icon"><CoinsIcon /></span> ממתינים לתשלום</div>
          <div className="pc-count"><AnimatedNumber value={awaitingPayment.length} /></div>
          <div className="muted" style={{ fontSize: 12 }}>
            {isAdmin && awaitingPaymentBalance > 0 ? `יתרה ${shekel(awaitingPaymentBalance)} · ` : ''}לחצו לרשימה ←
          </div>
        </Link>
        <div className="pipeline-card pc-new">
          <div className="pc-label"><span className="kpi-icon"><FileWarnIcon /></span> ממתינים למסמכים</div>
          <div className="pc-count"><AnimatedNumber value={summary.missingDocsCases} /></div>
          <div className="muted" style={{ fontSize: 12 }}>תיקים פתוחים עם מסמכים חסרים</div>
        </div>
        <div className="pipeline-card pc-stuck">
          <div className="pc-label"><span className="kpi-icon"><FlagIcon /></span> דורשים טיפול</div>
          <div className="pc-count"><AnimatedNumber value={summary.troubleCases} /></div>
          <div className="muted" style={{ fontSize: 12 }}>תיקים שסומנו כתקועים / נדרשת השלמה</div>
        </div>
        {isAdmin ? (
          <div className="pipeline-card pc-done">
            <div className="pc-label"><span className="kpi-icon"><CoinsIcon /></span> יתרה לגבייה</div>
            <div className="pc-count" style={{ fontSize: 30 }}>
              <AnimatedNumber value={summary.totalOutstanding} prefix="₪" />
            </div>
            <div className="muted" style={{ fontSize: 12 }}>שולם {shekel(summary.totalPaid)} מתוך {shekel(summary.totalFees)}</div>
          </div>
        ) : (
          <div className="pipeline-card pc-done">
            <div className="pc-label"><span className="kpi-icon"><FolderIcon /></span> תיקים סגורים</div>
            <div className="pc-count"><AnimatedNumber value={summary.closedCases} /></div>
          </div>
        )}
      </div>

      {isAdmin && summary.totalFees > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="donut-wrap">
            <CollectionDonut percent={(summary.totalPaid / summary.totalFees) * 100} />
            <div>
              <h3 style={{ margin: '0 0 4px' }}>אחוז גבייה כולל</h3>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                נגבו {shekel(summary.totalPaid)} מתוך {shekel(summary.totalFees)} שכר טרחה
                {summary.totalOutstanding > 0 && ` · נותרו ${shekel(summary.totalOutstanding)} לגבייה`}
              </p>
            </div>
          </div>
        </div>
      )}

      {isAdmin && <TeamOverview />}

      <div className="grid cols-2">
        <div className="card">
          <div className="section-heading">
            <h3 style={{ margin: 0 }}>דורשים טיפול</h3>
            <Link className="mini-link" href="/cases">כל התיקים ←</Link>
          </div>
          {attention.length === 0 ? (
            <p className="muted">אין תיקים שדורשים טיפול כרגע. 🎉</p>
          ) : (
            <div className="urgent-list">
              {attention.map((c) => (
                <Link key={c.id} className={`urgent-item ${c.troubleFlag ? 'urgent-trouble' : ''}`} href={`/cases/${c.id}` as never}>
                  <span className={`urgent-dot ${c.troubleFlag || c.stage === 'action-required' ? 'danger' : ''}`} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong>{c.troubleFlag && '🚩 '}{c.clientName}</strong> · {c.title}
                    <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                      {c.company && c.company !== 'none' ? optionLabel(config.companies, c.company, officeDisplayName(c)) : officeDisplayName(c)} · {stageLabelOf(config, c.stage)}
                      {c.troubleNote && ` · ${c.troubleNote}`}
                    </span>
                  </span>
                  {c.missing > 0 && <span className="badge danger">{c.missing} חסרים</span>}
                </Link>
              ))}
            </div>
          )}

          {unpaidClosed.length > 0 && (
            <>
              <div className="doc-group-title" style={{ marginTop: 22 }}>תיקים סגורים שטרם שולמו</div>
              <div className="urgent-list">
                {unpaidClosed.map((c) => (
                  <Link key={c.id} className="urgent-item" href={`/cases/${c.id}` as never}>
                    <span className="urgent-dot danger" />
                    <span style={{ flex: 1 }}>
                      <strong>{c.clientName}</strong> · {c.title}
                    </span>
                    <span className="badge warn">יתרה {shekel(c.finance.balance)}</span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <div className="section-heading">
              <h3 style={{ margin: 0 }}>משימות פתוחות</h3>
              <Link className="mini-link" href={'/tasks' as never}>לכל המשימות ←</Link>
            </div>
            {openTasks.length === 0 ? (
              <p className="muted">אין משימות פתוחות. 🎉</p>
            ) : (
              openTasks.map((task) => {
                const overdue = task.dueAt && new Date(task.dueAt).getTime() < Date.now();
                return (
                  <div key={task.id} className="task-row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="task-title">
                        {task.title}
                        <span className={`priority-badge ${task.priority}`} style={{ marginInlineStart: 8 }}>
                          {TASK_PRIORITY_LABELS[task.priority]}
                        </span>
                      </div>
                      <div className="task-meta">
                        {task.dueAt && (
                          <span className={overdue ? 'task-overdue' : ''}>
                            🗓 {new Date(task.dueAt).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            {overdue && ' · באיחור!'}
                          </span>
                        )}
                        <span>👤 {task.assigneeName}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="card">
            <div className="section-heading">
              <h3 style={{ margin: 0 }}>תיקים לפי שלב</h3>
            </div>
            {stageOrder.map((stage) => (
              <div key={stage} className="split" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <span style={{ fontSize: 14 }}>{stageLabelOf(config, stage)}</span>
                <strong>{summary.byStage[stage] ?? 0}</strong>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="section-heading">
              <h3 style={{ margin: 0 }}>פעילות אחרונה</h3>
            </div>
            {activity.length === 0 ? (
              <p className="muted">אין פעילות עדיין — התחל בהוספת לקוח ראשון.</p>
            ) : (
              <ul className="list">
                {activity.map((entry) => (
                  <li key={entry.id} style={{ fontSize: 13, lineHeight: 1.5 }}>
                    <span className="muted" style={{ fontSize: 11 }}>{formatDate(entry.at)}</span>
                    <br />
                    {entry.summary}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
