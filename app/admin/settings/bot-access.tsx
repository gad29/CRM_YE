'use client';

// The "חיבור בוט" tab: API keys that let an AI bot or an automation work in
// the system without a browser, where to point it, and what it did lately.
import '@/app/styles/admin.css';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { IconCopy } from '@/components/security-lists';
import { Field, Segmented, formatDate, timeAgo } from '@/components/ui/bits';
import { IconCheck, IconKey } from '@/components/ui/icons';
import { useToast } from '@/components/ui/toast';

type Role = 'owner' | 'admin' | 'worker';

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  accountId: string;
  accountName: string;
  accountRole: Role;
  accountActive: boolean;
  canWrite: boolean;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  lastUsedIp?: string;
  revokedAt?: string;
}

interface RequestRow {
  keyId: string;
  keyName: string;
  at: string;
  method: string;
  path: string;
}

interface Account {
  id: string;
  name: string;
  role: Role;
}

const ROLE: Record<Role, string> = { owner: 'בעלים', admin: 'מנהל', worker: 'עובד' };

const EXPIRY = [
  { value: '', label: 'ללא תפוגה' },
  { value: '30', label: '30 יום' },
  { value: '90', label: '3 חודשים' },
  { value: '365', label: 'שנה' },
];

function siteUrl(path: string) {
  return typeof window === 'undefined' ? path : `${window.location.origin}${path}`;
}

function CopyButton({ value, label = 'העתקה' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked: the value is on screen to copy by hand */
    }
  }
  return (
    <button type="button" className="button button-secondary button-compact" onClick={copy}>
      {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
      {copied ? 'הועתק' : label}
    </button>
  );
}

function status(k: KeyRow): { label: string; tone: '' | 'green' | 'red' | 'amber' } {
  if (k.revokedAt) return { label: 'בוטל', tone: 'red' };
  if (k.expiresAt && new Date(k.expiresAt).getTime() < Date.now()) return { label: 'פג תוקף', tone: 'amber' };
  if (!k.accountActive) return { label: 'החשבון מושבת', tone: 'amber' };
  return { label: 'פעיל', tone: 'green' };
}

/** What a logged request means, in words, with a link to what it touched. */
function describe(r: RequestRow): { text: string; href?: string } {
  const p = r.path.split('/').filter(Boolean).slice(1); // drop "api"
  const [area, id, sub] = p;
  const m = r.method;
  if (area === 'clients') {
    const href = id ? `/clients/${id}` : undefined;
    if (sub === 'documents') return { text: m === 'POST' ? 'העלה מסמך ללקוח' : 'ראה את מסמכי הלקוח', href };
    if (!id) return { text: m === 'POST' ? 'הוסיף לקוח' : 'עבר על רשימת הלקוחות' };
    return { text: m === 'PATCH' ? 'עדכן פרטי לקוח' : 'פתח כרטיס לקוח', href };
  }
  if (area === 'cases') {
    const href = id ? `/cases/${id}` : undefined;
    if (sub === 'checklist') return { text: m === 'POST' ? 'הוסיף מסמך נדרש לתיק' : 'עדכן מסמך נדרש בתיק', href };
    if (!id) return { text: m === 'POST' ? 'פתח תיק חדש' : 'עבר על רשימת התיקים' };
    return { text: m === 'PATCH' ? 'עדכן תיק' : 'פתח תיק', href };
  }
  if (area === 'documents') {
    if (id === 'send' || sub === 'send') return { text: 'שלח מסמכים ללקוח' };
    return { text: m === 'PATCH' ? 'שינה שם של מסמך' : 'פתח מסמך' };
  }
  if (area === 'tasks') return { text: m === 'POST' ? 'הוסיף משימה' : m === 'PATCH' ? 'עדכן משימה' : 'עבר על המשימות' };
  if (area === 'payments') return { text: m === 'POST' ? 'רשם תשלום' : m === 'PATCH' ? 'עדכן תשלום' : 'עבר על התשלומים' };
  if (area === 'config') return { text: 'קרא את ההגדרות' };
  if (area === 'activity') return { text: 'קרא את יומן הפעילות' };
  if (area === 'chat') return { text: m === 'POST' ? 'כתב בצ׳אט הצוות' : 'קרא את צ׳אט הצוות' };
  return { text: `${m} ${r.path}` };
}

function KeyItem({ k, onRevoke }: { k: KeyRow; onRevoke: (k: KeyRow) => void }) {
  const s = status(k);
  const live = s.tone === 'green';
  return (
    <div className={`sec-row ${live ? '' : 'bot-key-off'}`}>
      <span className={`sec-icon ${live ? 'ok' : ''}`}>
        <IconKey size={16} />
      </span>
      <div className="sec-main">
        <span className="sec-title">
          {k.name} <span className="mono muted">{k.prefix}…</span>
        </span>
        <span className="sec-sub">
          בשם {k.accountName} · {k.canWrite ? 'קריאה ועדכון' : 'קריאה בלבד'} · נוצר {formatDate(k.createdAt)}
          {k.expiresAt && !k.revokedAt && ` · בתוקף עד ${formatDate(k.expiresAt)}`}
        </span>
        <span className="sec-sub">
          {k.lastUsedAt ? (
            <>
              שימוש אחרון <span title={formatDate(k.lastUsedAt, true)}>{timeAgo(k.lastUsedAt)}</span>
              {k.lastUsedIp && <span className="ltr"> · {k.lastUsedIp}</span>}
            </>
          ) : (
            'עוד לא היה בשימוש'
          )}
        </span>
      </div>
      <span className={`chip ${s.tone}`}>{s.label}</span>
      {!k.revokedAt && (
        <button type="button" className="button button-danger button-compact" onClick={() => onRevoke(k)}>
          ביטול
        </button>
      )}
    </div>
  );
}

export function BotAccessCard() {
  const toast = useToast();
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [access, setAccess] = useState<'read' | 'write'>('write');
  const [expiry, setExpiry] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ name: string; secret: string } | null>(null);

  const reload = useCallback(() => {
    fetch('/api/api-keys')
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return setError(d.error || 'הרשימה לא נטענה');
        setKeys(d.data.keys);
        setRequests(d.data.requests);
        setAccounts(d.data.accounts);
      })
      .catch(() => setError('אין חיבור לשרת'));
  }, []);

  useEffect(reload, [reload]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, accountId: accountId || undefined, canWrite: access === 'write', expiresInDays: expiry ? Number(expiry) : null }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        toast(d.error || 'המפתח לא נוצר', 'error');
        return;
      }
      setCreated({ name: d.data.key.name, secret: d.data.secret });
      setName('');
      reload();
    } catch {
      toast('אין חיבור לשרת — המפתח לא נוצר', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function revoke(k: KeyRow) {
    if (!window.confirm(`לבטל את המפתח "${k.name}"? מה שמשתמש בו ינותק מיד, ואי אפשר להחזיר אותו.`)) return;
    const res = await fetch(`/api/api-keys/${k.id}`, { method: 'DELETE' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) return toast(d.error || 'הביטול נכשל', 'error');
    toast('המפתח בוטל');
    reload();
  }

  const mcpUrl = siteUrl('/api/mcp');
  const openApiUrl = siteUrl('/api/openapi.json');
  const exampleConfig = created
    ? JSON.stringify({ mcpServers: { crm: { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer ${created.secret}` } } } }, null, 2)
    : '';

  return (
    <>
      <section className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">חיבור בוט</h2>
            <div className="card-sub">
              בוט AI או אוטומציה יכולים לעבוד במערכת בלי דפדפן: לחפש לקוחות, לפתוח תיקים, להזיז שלבים, להעלות ולשלוח מסמכים ולהוסיף משימות. כל בוט מקבל מפתח משלו. המפתח פועל בשם אחד מאנשי הצוות ורואה רק מה שהוא רואה, ובמפתח אי אפשר למחוק כלום.
            </div>
          </div>
        </div>

        <div className="bot-connect">
          <div className="bot-connect-row">
            <div className="bot-connect-text">
              <span className="strong">כתובת החיבור (MCP)</span>
              <span className="tiny muted">לבוטים שמתחברים לכלים: Claude, ChatGPT, n8n, OpenClaw ודומיהם</span>
              <span className="mono bot-connect-value">{mcpUrl}</span>
            </div>
            <CopyButton value={mcpUrl} />
          </div>
          <div className="bot-connect-row">
            <div className="bot-connect-text">
              <span className="strong">תיאור הממשק (OpenAPI)</span>
              <span className="tiny muted">לכלים שעובדים עם בקשות רגילות: GPT Actions, Make, Zapier</span>
              <span className="mono bot-connect-value">{openApiUrl}</span>
            </div>
            <CopyButton value={openApiUrl} />
          </div>
          <p className="tiny muted bot-connect-note">
            בשני המקרים הבוט שולח את המפתח בכותרת <span className="mono">Authorization: Bearer &lt;המפתח&gt;</span>.
          </p>
        </div>

        {created ? (
          <div className="temp-pass bot-secret">
            <div className="small strong">המפתח של "{created.name}"</div>
            <div className="temp-pass-value">
              <span className="mono">{created.secret}</span>
              <CopyButton value={created.secret} />
            </div>
            <div className="small muted">הוא מוצג עכשיו בלבד: המערכת שומרת רק טביעה שלו. העתיקו אותו להגדרות הבוט. אם הוא אבד, מבטלים ויוצרים חדש.</div>
            <details className="bot-example">
              <summary className="small">דוגמת הגדרה לבוט שמתחבר ב-MCP</summary>
              <pre className="mono">{exampleConfig}</pre>
              <CopyButton value={exampleConfig} label="העתקת ההגדרה" />
            </details>
            <div>
              <button type="button" className="button button-secondary button-compact" onClick={() => setCreated(null)}>
                סגירה
              </button>
            </div>
          </div>
        ) : (
          <form className="bot-form" onSubmit={create}>
            <Field label="שם המפתח" required hint="כדי לזהות אותו ברשימה, למשל: הבוט בוואטסאפ">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder="הבוט שלי" />
            </Field>
            <Field label="פועל בשם" hint="הבוט יראה ויעשה רק מה שהאדם הזה רשאי">
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">אני</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {ROLE[a.role]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="הרשאה">
              <Segmented
                label="הרשאה"
                value={access}
                onChange={setAccess}
                options={[
                  { value: 'write', label: 'קריאה ועדכון' },
                  { value: 'read', label: 'קריאה בלבד' },
                ]}
              />
            </Field>
            <Field label="תוקף">
              <select value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                {EXPIRY.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="bot-form-foot">
              <button type="submit" className="button button-compact" disabled={creating || !name.trim()}>
                <IconKey size={15} />
                {creating ? 'יוצר…' : 'יצירת מפתח'}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">מפתחות</h2>
            <div className="card-sub">ביטול מנתק מיד את מה שמשתמש במפתח. גם השבתת החשבון שהמפתח פועל בשמו עוצרת אותו.</div>
          </div>
        </div>
        {error && <p className="form-error">{error}</p>}
        {!keys ? (
          !error && <div className="skeleton" style={{ height: 90 }} />
        ) : keys.length === 0 ? (
          <p className="small muted">עוד אין מפתחות. יוצרים אחד למעלה ומדביקים אותו בהגדרות הבוט.</p>
        ) : (
          <div>
            {keys.filter((k) => !k.revokedAt).map((k) => (
              <KeyItem key={k.id} k={k} onRevoke={revoke} />
            ))}
            {keys.some((k) => k.revokedAt) && (
              <details className="bot-revoked">
                <summary className="small muted">{keys.filter((k) => k.revokedAt).length} מפתחות שבוטלו</summary>
                {keys.filter((k) => k.revokedAt).map((k) => (
                  <KeyItem key={k.id} k={k} onRevoke={revoke} />
                ))}
              </details>
            )}
          </div>
        )}
      </section>

      {keys && keys.length > 0 && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">מה הבוט עשה לאחרונה</h2>
              <div className="card-sub">כל פעולה של מפתח נרשמת כאן ל-60 יום. שינויים שהבוט עשה מופיעים גם ביומן הפעילות הרגיל.</div>
            </div>
          </div>
          {requests.length === 0 ? (
            <p className="small muted">עוד לא נעשתה פעולה עם מפתח.</p>
          ) : (
            <div className="bot-log">
              {requests.map((r, i) => {
                const d = describe(r);
                return (
                  <div key={`${r.at}-${i}`} className="bot-log-row">
                    <span className="sec-sub nowrap" title={formatDate(r.at, true)}>
                      {timeAgo(r.at)}
                    </span>
                    <span className="truncate">
                      {d.href ? (
                        <Link href={d.href as never} className="text-link">
                          {d.text}
                        </Link>
                      ) : (
                        d.text
                      )}
                    </span>
                    <span className="sec-sub truncate">{r.keyName}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </>
  );
}
