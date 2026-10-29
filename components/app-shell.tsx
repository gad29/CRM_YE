'use client';

// The frame around every signed-in page: sidebar (grouped by purpose),
// topbar (search · one "new" button · reminders · theme), and the global
// "new client / new case" wizard.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useConfig } from '@/components/config-provider';
import { NewCaseWizard, type WizardStart } from '@/components/new-case-wizard';
import { useSession } from '@/components/session-provider';
import { TaskAlerts } from '@/components/task-alerts';
import { initials } from '@/components/ui/bits';
import {
  IconBell,
  IconChat,
  IconClients,
  IconFolder,
  IconHistory,
  IconLogout,
  IconMenu,
  IconMoon,
  IconPlug,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSun,
  IconTasks,
  IconToday,
  IconUsersCog,
  IconWallet,
} from '@/components/ui/icons';

// ── "New" flow, reachable from anywhere ─────────────────────────────────────

const NewFlowContext = createContext<(start?: WizardStart) => void>(() => undefined);
export function useNewFlow() {
  return useContext(NewFlowContext);
}

type NavItem = { href: string; label: string; Icon: (p: { size?: number }) => ReactNode; badge?: number };

const ROLE_NAMES = { owner: 'בעל המערכת', admin: 'מנהל', worker: 'עובד' } as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const config = useConfig();
  const { me } = useSession();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [wizard, setWizard] = useState<WizardStart | null>(null);

  // A temporary password issued by an admin must be replaced first.
  useEffect(() => {
    if (me?.mustChangePassword && pathname !== '/account') router.replace('/account?mustChange=1' as never);
  }, [me, pathname, router]);

  useEffect(() => setOpen(false), [pathname]);

  // Chat badge, paused while the tab is hidden.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (document.visibilityState !== 'visible') return;
      try {
        const d = await fetch('/api/chat/unread').then((r) => r.json());
        if (!cancelled && d.ok) setUnread(d.data.unread);
      } catch {
        /* try again next tick */
      }
    }
    void load();
    const t = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [pathname]);

  const openWizard = useCallback((start?: WizardStart) => setWizard(start ?? { mode: 'client' }), []);

  const work: NavItem[] = [
    { href: '/today', label: 'היום', Icon: IconToday },
    { href: '/clients', label: 'לקוחות', Icon: IconClients },
    { href: '/cases', label: 'תיקים', Icon: IconFolder },
    { href: '/tasks', label: 'משימות', Icon: IconTasks },
    { href: '/chat', label: 'צ׳אט צוות', Icon: IconChat, badge: unread },
  ];
  const money: NavItem[] = [{ href: '/payments', label: 'תשלומים וגבייה', Icon: IconWallet }];
  const admin: NavItem[] = [
    { href: '/admin/users', label: 'משתמשים והרשאות', Icon: IconUsersCog },
    { href: '/admin/settings', label: 'הגדרות', Icon: IconSettings },
    { href: '/admin/connections', label: 'אימייל ווואטסאפ', Icon: IconPlug },
    { href: '/admin/activity', label: 'יומן פעילות', Icon: IconHistory },
  ];

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const nav = (items: NavItem[]) =>
    items.map(({ href, label, Icon, badge }) => (
      <Link key={href} href={href as never} className={`nav-link ${isActive(href) ? 'active' : ''}`} aria-current={isActive(href) ? 'page' : undefined}>
        <Icon size={18} />
        {label}
        {badge ? <span className="nav-count">{badge}</span> : null}
      </Link>
    ));

  return (
    <NewFlowContext.Provider value={openWizard}>
      <div className="app-frame">
        {open && <div className="sidebar-scrim" onClick={() => setOpen(false)} />}
        <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="ניווט">
          <Link href={'/today' as never} className="sidebar-brand">
            <span className="brand-mark">{(config.businessName || 'C').trim()[0]}</span>
            <span style={{ minWidth: 0 }}>
              <div className="brand-name truncate">{config.businessName}</div>
              <div className="brand-sub truncate">{config.sidebarSubtitle}</div>
            </span>
          </Link>

          <nav className="nav-group">{nav(work)}</nav>
          {me?.isAdmin && (
            <>
              <nav className="nav-group">
                <div className="nav-group-label">כספים</div>
                {nav(money)}
              </nav>
              <nav className="nav-group">
                <div className="nav-group-label">ניהול המערכת</div>
                {nav(admin)}
              </nav>
            </>
          )}

          <div className="sidebar-foot">
            <Link href={'/account' as never} className="me-card">
              <span className="avatar">{initials(me?.name)}</span>
              <span style={{ minWidth: 0 }}>
                <div className="strong truncate">{me?.name || '…'}</div>
                <div className="tiny muted">{me ? ROLE_NAMES[me.role] : ''}</div>
              </span>
            </Link>
            <button type="button" className="button button-quiet button-compact" onClick={signOut} style={{ justifyContent: 'flex-start' }}>
              <IconLogout size={16} /> יציאה
            </button>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <button type="button" className="icon-button menu-toggle" onClick={() => setOpen(true)} aria-label="פתיחת התפריט">
              <IconMenu />
            </button>
            <GlobalSearch />
            <div className="spacer" />
            <button type="button" className="button" onClick={() => openWizard()}>
              <IconPlus size={17} /> לקוח חדש
            </button>
            <ReminderBell />
            <ThemeToggle />
          </header>
          <main className="page" key={pathname}>
            {children}
          </main>
        </div>
      </div>

      {wizard && <NewCaseWizard start={wizard} onClose={() => setWizard(null)} />}
      {/* The chat has its own composer in that corner. */}
      {pathname !== '/chat' && <TaskAlerts />}
    </NewFlowContext.Provider>
  );
}

// ── Search: clients by name / phone / ID, cases by number or title ──────────

type Hit = { kind: 'client' | 'case'; id: string; title: string; sub: string; href: string };

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ clients: Record<string, string>[]; cases: Record<string, string>[] } | null>(null);
  const [show, setShow] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);

  async function ensure() {
    if (data) return;
    try {
      const [c, k] = await Promise.all([fetch('/api/clients').then((r) => r.json()), fetch('/api/cases').then((r) => r.json())]);
      setData({ clients: c.ok ? c.data : [], cases: k.ok ? k.data : [] });
    } catch {
      /* stays empty */
    }
  }

  useEffect(() => {
    const onDown = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setShow(false);
    const onKey = (e: KeyboardEvent) => {
      // "/" jumps to search from anywhere (not while typing elsewhere).
      if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        wrap.current?.querySelector('input')?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const hits = useMemo<Hit[]>(() => {
    const term = q.trim().toLowerCase();
    if (!term || !data) return [];
    const has = (v: unknown) => String(v ?? '').toLowerCase().includes(term);
    const digits = term.replace(/\D/g, '');
    const phoneHit = (v: unknown) => digits.length >= 3 && String(v ?? '').replace(/\D/g, '').includes(digits);
    const clients = data.clients
      .filter((c) => has(c.fullName) || has(c.idNumber) || has(c.email) || phoneHit(c.phone))
      .slice(0, 6)
      .map((c): Hit => ({ kind: 'client', id: c.id, title: c.fullName, sub: [c.phone, c.idNumber && `ת״ז ${c.idNumber}`].filter(Boolean).join(' · '), href: `/clients/${c.id}` }));
    const cases = data.cases
      .filter((c) => has(c.id) || has(c.title) || has(c.referenceNumber) || has(c.clientName))
      .slice(0, 6)
      .map((c): Hit => ({ kind: 'case', id: c.id, title: `${c.clientName} · ${c.title}`, sub: c.id, href: `/cases/${c.id}` }));
    return [...clients, ...cases];
  }, [q, data]);

  function go(hit: Hit) {
    setShow(false);
    setQ('');
    router.push(hit.href as never);
  }

  return (
    <div className="search" ref={wrap}>
      <IconSearch size={17} />
      <input
        value={q}
        placeholder="חיפוש לקוח, טלפון, ת״ז או מספר תיק"
        aria-label="חיפוש"
        onFocus={() => {
          void ensure();
          setShow(true);
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setShow(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter' && hits[active]) go(hits[active]);
          if (e.key === 'Escape') setShow(false);
        }}
      />
      {show && q.trim() && (
        <div className="search-results" role="listbox">
          {!data && <div className="search-hit muted">טוען…</div>}
          {data && hits.length === 0 && <div className="search-hit muted">לא נמצא דבר עבור &quot;{q}&quot;</div>}
          {hits.map((h, i) => (
            <div key={`${h.kind}-${h.id}`} role="option" aria-selected={i === active} className={`search-hit ${i === active ? 'active' : ''}`} onMouseDown={() => go(h)} onMouseEnter={() => setActive(i)}>
              {h.kind === 'client' ? <IconClients size={16} /> : <IconFolder size={16} />}
              <span style={{ minWidth: 0, flex: 1 }}>
                <div className="strong truncate">{h.title}</div>
                <div className="tiny muted truncate">{h.sub}</div>
              </span>
              <span className="chip">{h.kind === 'client' ? 'לקוח' : 'תיק'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Reminder bell: open tasks that are due or urgent ────────────────────────

function ReminderBell() {
  const router = useRouter();
  const [due, setDue] = useState<{ id: string; title: string; priority: string; dueAt?: string }[]>([]);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (document.visibilityState !== 'visible') return;
      try {
        const d = await fetch('/api/tasks').then((r) => r.json());
        if (!d.ok || cancelled) return;
        const now = Date.now();
        setDue(
          (d.data as { id: string; title: string; status: string; priority: string; dueAt?: string }[])
            .filter((t) => t.status === 'open' && ((t.dueAt && new Date(t.dueAt).getTime() <= now) || t.priority === 'urgent'))
            .slice(0, 8),
        );
      } catch {
        /* try again later */
      }
    }
    void load();
    const t = setInterval(load, 90_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="menu-wrap" ref={wrap}>
      <button type="button" className="icon-button" onClick={() => setOpen((v) => !v)} aria-label="משימות שדורשות טיפול" aria-expanded={open}>
        <IconBell />
        {due.length > 0 && <span className="dot">{due.length}</span>}
      </button>
      {open && (
        <div className="menu" style={{ minWidth: 300 }}>
          <div className="tiny muted strong" style={{ padding: '6px 10px' }}>משימות שדורשות טיפול</div>
          {due.length === 0 && <div className="menu-item muted">אין משימות באיחור</div>}
          {due.map((t) => (
            <button key={t.id} type="button" className="menu-item" onClick={() => { setOpen(false); router.push('/tasks' as never); }}>
              <span className={`chip ${t.priority === 'urgent' ? 'red' : 'amber'}`}>{t.priority === 'urgent' ? 'דחוף' : 'באיחור'}</span>
              <span className="truncate">{t.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.getAttribute('data-theme') === 'dark'), []);
  function toggle() {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    try {
      localStorage.setItem('crmye-theme', next ? 'dark' : 'light');
    } catch {
      /* private mode — theme just won't persist */
    }
  }
  return (
    <button type="button" className="icon-button" onClick={toggle} aria-label={dark ? 'מצב בהיר' : 'מצב כהה'}>
      {dark ? <IconSun /> : <IconMoon />}
    </button>
  );
}
