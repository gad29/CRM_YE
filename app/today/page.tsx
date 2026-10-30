import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { CSSProperties } from 'react';
import {
  caseHandlerId,
  companyColor,
  countMissingItems,
  isUnderInvestigation,
  optionLabel,
  stageLabelOf,
  TASK_PRIORITY_LABELS,
  type TaskPriority,
} from '@/lib/domain';
import { getCurrentSession } from '@/lib/admin-session';
import {
  getCaseFinance,
  getConfig,
  listActivity,
  listClients,
  listPayments,
  listVisibleCases,
  listVisibleTasks,
} from '@/lib/store';
import { listUsers, isAdminRole } from '@/lib/users';
import { sessionToViewer } from '@/lib/viewer';
import { inTray, traysOf } from '@/components/case-trays';
import { IconArrowLeft, IconClock, IconFlag, IconFolder, IconHistory, IconTasks } from '@/components/ui/icons';
import { TodayNewClient, TodayTaskDone } from './today-actions';
import '../styles/lists.css';

export const dynamic = 'force-dynamic';

const TZ = 'Asia/Jerusalem';

function greeting(now: Date) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: TZ }).format(now));
  if (hour < 5) return 'לילה טוב';
  if (hour < 12) return 'בוקר טוב';
  if (hour < 17) return 'צהריים טובים';
  return 'ערב טוב';
}

function shekel(amount: number) {
  return `₪${amount.toLocaleString('he-IL', { maximumFractionDigits: 0 })}`;
}

function when(iso: string) {
  return new Date(iso).toLocaleString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

function dueLabel(iso?: string) {
  if (!iso) return { text: 'ללא תאריך יעד', overdue: false };
  const due = new Date(iso);
  const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
  const today = dayKey(new Date());
  const tomorrow = dayKey(new Date(Date.now() + 86400000));
  const time = due.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  if (due.getTime() < Date.now()) return { text: `באיחור · ${when(iso)}`, overdue: true };
  if (dayKey(due) === today) return { text: `היום ${time}`, overdue: false };
  if (dayKey(due) === tomorrow) return { text: `מחר ${time}`, overdue: false };
  return { text: when(iso), overdue: false };
}

export default async function TodayPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/login');
  const viewer = sessionToViewer(session);
  const isAdmin = viewer.role === 'admin';
  const me = session.accountId;
  const now = new Date();

  const [config, clients, payments, cases, tasks, activityAll] = await Promise.all([
    getConfig(),
    listClients(),
    listPayments(),
    listVisibleCases(viewer),
    listVisibleTasks(viewer),
    listActivity({ limit: 60 }),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.fullName]));

  const rows = cases.map((c) => ({
    ...c,
    clientName: clientName.get(c.clientId) || '',
    missingItems: countMissingItems(c),
    finance: getCaseFinance(c, payments),
  }));
  const open = rows.filter((c) => c.stage !== 'closed');
  const trays = traysOf(config);
  const paymentsOn = config.modules.payments;
  const tasksOn = config.modules.tasks;
  const trayCounts = Object.fromEntries(trays.map((t) => [t.id, rows.filter((c) => inTray(c, t.id, config)).length]));
  const paymentBalance = rows.filter((c) => inTray(c, 'payment', config)).reduce((s, c) => s + c.finance.balance, 0);

  // Cases that need a person today: flagged first, then the ones the office sent back, then missing paperwork.
  const attention = open
    .filter((c) => c.troubleFlag || isUnderInvestigation(c) || c.stage === 'action-required' || c.missingItems > 0)
    .sort((a, b) => {
      const rank = (c: (typeof open)[number]) =>
        c.troubleFlag || isUnderInvestigation(c) ? 0 : c.stage === 'action-required' ? 1 : 2;
      return rank(a) - rank(b) || a.updatedAt.localeCompare(b.updatedAt);
    })
    .slice(0, 7);

  const unpaidClosed = isAdmin && paymentsOn ? rows.filter((c) => c.stage === 'closed' && c.finance.balance > 0).slice(0, 5) : [];

  const priorityOrder: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2 };
  const openTasks = tasks
    .filter((t) => t.status === 'open')
    .sort((a, b) => {
      const mine = Number(b.assigneeId === me) - Number(a.assigneeId === me);
      if (mine) return mine;
      return (a.dueAt || '9999').localeCompare(b.dueAt || '9999') || priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  const myTasks = openTasks.filter((t) => t.assigneeId === me);
  const shownTasks = (myTasks.length > 0 ? myTasks : openTasks).slice(0, 7);

  const users = isAdmin ? await listUsers() : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const team = users
    .filter((u) => u.active)
    .map((u) => {
      const handled = open.filter((c) => caseHandlerId(c) === u.id);
      return { id: u.id, name: u.name, admin: isAdminRole(u.role), open: handled.length, flagged: handled.filter((c) => inTray(c, 'flagged', config)).length };
    })
    .sort((a, b) => b.open - a.open);

  const visibleClientIds = new Set(rows.map((c) => c.clientId));
  const activity = activityAll.filter((a) => isAdmin || (a.clientId && visibleClientIds.has(a.clientId))).slice(0, 10);

  const totals = isAdmin && paymentsOn
    ? rows.reduce((acc, c) => ({ fee: acc.fee + c.finance.fee, paid: acc.paid + c.finance.paid, balance: acc.balance + c.finance.balance }), { fee: 0, paid: 0, balance: 0 })
    : null;

  const dateLine = now.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
  const firstName = (session.name || '').trim().split(/\s+/)[0];

  return (
    <div className="today">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="page-eyebrow">{dateLine}</div>
          <h1 className="page-title">{greeting(now)}{firstName ? `, ${firstName}` : ''}</h1>
          <div className="page-sub">
            {open.length === 0
              ? 'אין תיקים פעילים כרגע.'
              : `${open.length} תיקים פעילים${isAdmin ? ` · ${clients.length} לקוחות במערכת` : ''}`}
          </div>
        </div>
      </div>

      <div className="tray-row">
        {trays.map((t) => (
          <Link key={t.id} href={`/cases?tray=${t.id}` as never} className={`tray ${trayCounts[t.id] > 0 ? t.tone : ''}`}>
            <span className="tray-count">{trayCounts[t.id]}</span>
            <span className="tray-label">{t.label}</span>
            <span className="tray-hint">
              {t.id === 'payment' && isAdmin && paymentsOn && paymentBalance > 0 ? `יתרה ${shekel(paymentBalance)}` : t.hint}
            </span>
          </Link>
        ))}
      </div>

      <div className="layout-aside today-grid">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <div>
                <div className="card-title">דורשים טיפול</div>
                <div className="card-sub">מסומנים, הוחזרו מהמשרד, או חסרים בהם מסמכים</div>
              </div>
              <Link className="text-link small" href={'/cases' as never}>כל התיקים</Link>
            </div>
            {attention.length === 0 ? (
              rows.length === 0 ? (
                <div className="empty">
                  <IconFolder size={30} />
                  <div className="empty-title">עוד אין תיקים</div>
                  <div className="small">מתחילים בלקוח הראשון: פרטים, חברה מטפלת ורשימת מסמכים, בשלושה צעדים.</div>
                  <div style={{ marginTop: 6 }}><TodayNewClient /></div>
                </div>
              ) : (
                <div className="empty">
                  <IconFolder size={30} />
                  <div className="empty-title">כל התיקים מסודרים</div>
                  <div className="small">אין תיק מסומן ואין מסמך חסר. זה הזמן לעבור על הממתינים למשרד.</div>
                </div>
              )
            ) : (
              <div className="list">
                {attention.map((c) => {
                  const co = companyColor(config, c.company);
                  const flagged = c.troubleFlag || isUnderInvestigation(c);
                  return (
                    <Link key={c.id} href={`/cases/${c.id}` as never} className="list-row attention-row" style={co ? ({ '--co': co } as CSSProperties) : undefined}>
                      <span className="attention-edge" aria-hidden="true" />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        {flagged && <IconFlag size={13} className="attention-flag" aria-hidden="true" />}
                        <span className="list-title">{c.clientName}</span>
                        <span className="list-sub"> · {c.title}</span>
                        <span className="list-sub" style={{ display: 'block' }}>
                          {c.company && c.company !== 'none' ? `${optionLabel(config.companies, c.company, '')} · ` : ''}
                          {stageLabelOf(config, c.stage)}
                          {c.troubleNote ? ` · ${c.troubleNote}` : ''}
                        </span>
                      </span>
                      {flagged && (
                        <span className="chip red attention-chip">{isUnderInvestigation(c) ? 'בבירור' : 'מסומן'}</span>
                      )}
                      {!flagged && c.stage === 'action-required' && <span className="chip amber attention-chip">{stageLabelOf(config, 'action-required')}</span>}
                      {c.missingItems > 0 && <span className="stamp missing">{c.missingItems} חסרים</span>}
                    </Link>
                  );
                })}
              </div>
            )}

            {unpaidClosed.length > 0 && (
              <>
                <div className="today-subhead">נסגרו ועוד לא שולמו</div>
                <div className="list">
                  {unpaidClosed.map((c) => (
                    <Link key={c.id} href={`/cases/${c.id}` as never} className="list-row">
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="list-title">{c.clientName}</span>
                        <span className="list-sub"> · {c.title}</span>
                      </span>
                      <span className="chip amber num">יתרה {shekel(c.finance.balance)}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </section>

          {tasksOn && (
          <section className="card">
            <div className="card-head">
              <div>
                <div className="card-title">{myTasks.length > 0 || !isAdmin ? 'המשימות שלי' : 'משימות פתוחות בצוות'}</div>
                <div className="card-sub">
                  {openTasks.length === 0
                    ? 'אין משימות פתוחות'
                    : myTasks.length > 0
                      ? `${myTasks.length} שלך${openTasks.length > myTasks.length ? ` · ${openTasks.length} בסך הכול` : ''}`
                      : `${openTasks.length} פתוחות`}
                </div>
              </div>
              <Link className="text-link small" href={'/tasks' as never}>לכל המשימות</Link>
            </div>
            {shownTasks.length === 0 ? (
              <div className="empty">
                <IconTasks size={30} />
                <div className="empty-title">אין משימות פתוחות</div>
                <div className="small">משימה עם תזכורת בוואטסאפ או במייל נפתחת מכל תיק, או מעמוד המשימות.</div>
                <div style={{ marginTop: 6 }}>
                  <Link className="button button-secondary button-compact" href={'/tasks' as never}>משימה חדשה</Link>
                </div>
              </div>
            ) : (
              <div className="list">
                {shownTasks.map((t) => {
                  const due = dueLabel(t.dueAt);
                  return (
                    <div key={t.id} className="list-row">
                      <TodayTaskDone taskId={t.id} title={t.title} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="list-title">{t.title}</span>
                        <span className="list-sub" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span className={due.overdue ? 'due overdue' : 'due'}><IconClock size={13} /> {due.text}</span>
                          {t.assigneeId !== me && <span>· {userName.get(t.assigneeId) || 'עובד'}</span>}
                          {t.caseId && (
                            <Link className="text-link" href={`/cases/${t.caseId}` as never}>
                              · {clientName.get(rows.find((c) => c.id === t.caseId)?.clientId || '') || 'לתיק'}
                            </Link>
                          )}
                        </span>
                      </span>
                      {t.priority !== 'normal' && (
                        <span className={`chip ${t.priority === 'urgent' ? 'red' : 'amber'}`}>{TASK_PRIORITY_LABELS[t.priority]}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          )}
        </div>

        <aside className="stack">
          {isAdmin && team.length > 0 && (
            <section className="card">
              <div className="card-head">
                <div className="card-title">הצוות</div>
                <Link className="text-link small" href={'/admin/users' as never}>ניהול משתמשים</Link>
              </div>
              <div className="list">
                {team.map((p) => (
                  <Link key={p.id} href={`/cases?handler=${encodeURIComponent(p.id)}` as never} className="list-row">
                    <span className="avatar">{p.name.trim().slice(0, 1)}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="list-title">{p.name}</span>
                      <span className="list-sub" style={{ display: 'block' }}>
                        {p.open === 0 ? 'אין תיקים פעילים' : `${p.open} תיקים פעילים`}
                        {p.admin ? ' · מנהל' : ''}
                      </span>
                    </span>
                    {p.flagged > 0 && <span className="chip red num">{p.flagged} מסומנים</span>}
                    <IconArrowLeft size={15} className="muted" />
                  </Link>
                ))}
              </div>
            </section>
          )}

          {totals && totals.fee > 0 && (
            <section className="card">
              <div className="card-title">גבייה</div>
              <div className="collect">
                <div className="collect-bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, Math.round((totals.paid / totals.fee) * 100))}%` }} />
                </div>
                <div className="collect-line">
                  <span>נגבו <strong className="num">{shekel(totals.paid)}</strong></span>
                  <span className="muted">מתוך {shekel(totals.fee)}</span>
                </div>
                {totals.balance > 0 && (
                  <Link className="text-link small" href={'/payments' as never}>
                    {shekel(totals.balance)} פתוחים לגבייה
                  </Link>
                )}
              </div>
            </section>
          )}

          <section className="card">
            <div className="card-head">
              <div className="card-title">פעילות אחרונה</div>
              {isAdmin && <Link className="text-link small" href={'/admin/activity' as never}>יומן מלא</Link>}
            </div>
            {activity.length === 0 ? (
              <div className="empty">
                <IconHistory size={28} />
                <div className="small">כל פעולה בתיקים, במסמכים ובתשלומים תופיע כאן.</div>
              </div>
            ) : (
              <ol className="feed">
                {activity.map((a) => (
                  <li key={a.id}>
                    <span className="feed-time">{when(a.at)}</span>
                    {a.caseId ? (
                      <Link href={`/cases/${a.caseId}` as never}>{a.summary}</Link>
                    ) : a.clientId ? (
                      <Link href={`/clients/${a.clientId}` as never}>{a.summary}</Link>
                    ) : (
                      <span>{a.summary}</span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
