import '@/app/styles/tools.css';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { emailProvider, env, hasWhatsAppConfig } from '@/lib/env';
import { PageHead } from '@/components/ui/bits';
import { IconBell, IconMail, IconShield, IconWhatsapp } from '@/components/ui/icons';
import { ConnectionTools } from './connection-tools';

export const dynamic = 'force-dynamic';

function Status({ ok, okText, offText }: { ok: boolean; okText: string; offText: string }) {
  return <span className={`status-dot ${ok ? 'ok' : 'off'}`}>{ok ? okText : offText}</span>;
}

function Env({ name }: { name: string }) {
  return <code className="env">{name}</code>;
}

function ConnCard({ icon, title, status, children }: { icon: ReactNode; title: string; status: ReactNode; children: ReactNode }) {
  return (
    <section className="card conn-card">
      <div className="conn-head">
        <span className="icon">{icon}</span>
        <h2 className="card-title">{title}</h2>
        {status}
      </div>
      {children}
    </section>
  );
}

export default function ConnectionsPage() {
  const provider = emailProvider();
  const emailReady = provider !== null;
  const whatsappReady = hasWhatsAppConfig();
  const webhookUrl = `${env.appBaseUrl}/api/webhooks/whatsapp`;
  const fromName = env.emailFromName;

  return (
    <>
      <PageHead
        title="חיבורים"
        sub="מאיפה המערכת שולחת מיילים והודעות וואטסאפ. המפתחות שמורים בקובץ ההגדרות של השרת בלבד, ולא נראים כאן."
      />

      <div className="conn-grid" style={{ marginBottom: 16 }}>
        <ConnCard icon={<IconMail />} title={provider === 'resend' ? 'מייל (Resend)' : 'מייל (Gmail)'} status={<Status ok={emailReady} okText="מחובר" offText="לא מוגדר" />}>
          {provider === 'gmail' ? (
            <>
              <div className="conn-value">{fromName ? `${fromName} <${env.gmailUser}>` : env.gmailUser}</div>
              <p className="small ink-2" style={{ margin: 0 }}>
                המיילים יוצאים מחשבון ה-Gmail של העסק, נשמרים אצלו ב&quot;דואר יוצא&quot;, ותשובות של לקוחות מגיעות ישר לתיבה שלו.
              </p>
            </>
          ) : provider === 'resend' ? (
            <>
              <div className="conn-value">{env.emailFrom}</div>
              <p className="small ink-2" style={{ margin: 0 }}>
                המיילים יוצאים דרך Resend מהכתובת הזאת. כדי שייצאו מה-Gmail של העסק, מגדירים <Env name="GMAIL_USER" /> ו-<Env name="GMAIL_APP_PASSWORD" />.
              </p>
            </>
          ) : (
            <p className="small ink-2" style={{ margin: 0 }}>
              כדי לשלוח מה-Gmail של העסק מגדירים בשרת <Env name="GMAIL_USER" /> ו-<Env name="GMAIL_APP_PASSWORD" /> (סיסמת אפליקציה של Google, דורשת אימות דו-שלבי בחשבון). ללא עלות, עד כ-500 מיילים ביום.
            </p>
          )}
        </ConnCard>

        <ConnCard icon={<IconWhatsapp />} title="וואטסאפ (Meta)" status={<Status ok={whatsappReady} okText="מחובר" offText="לא מוגדר" />}>
          <div className="conn-value">{env.whatsappPhoneNumberId ? `Phone number ID ${env.whatsappPhoneNumberId}` : '—'}</div>
          <p className="small ink-2" style={{ margin: 0 }}>
            נדרש: <Env name="WHATSAPP_ACCESS_TOKEN" /> ו-<Env name="WHATSAPP_PHONE_NUMBER_ID" />. כל הודעה יוצאת בתבנית שאושרה ב-Meta (שפה <Env name={env.whatsappTemplateLang} />).
          </p>
        </ConnCard>

        <ConnCard icon={<IconBell />} title="תזכורות" status={<Status ok={emailReady || whatsappReady} okText="פעיל" offText="אין ערוץ שליחה" />}>
          <p className="small ink-2" style={{ margin: 0 }}>
            המערכת בודקת כל דקה אילו תזכורות הגיע זמנן ושולחת כל אחת פעם אחת בדיוק, בערוצים שנבחרו במשימה. אם השליחה נכשלת, היא מנסה שוב עד 3 פעמים.
          </p>
        </ConnCard>

        <ConnCard icon={<IconShield />} title="כניסה למערכת" status={<Status ok okText="מוגן" offText="" />}>
          <p className="small ink-2" style={{ margin: 0 }}>
            כל אחד נכנס עם המייל והסיסמה שלו. ניסיונות כניסה שגויים חוסמים זמנית, וכל כניסה נרשמת. השבתת משתמש או החלפת סיסמה מנתקות אותו מיד.
          </p>
          <Link href={'/admin/users' as never} className="text-link small">
            ניהול משתמשים והתחברויות
          </Link>
        </ConnCard>
      </div>

      <div className="stack">
        <ConnectionTools emailReady={emailReady} whatsappReady={whatsappReady} />

        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">תבניות וואטסאפ</h2>
              <div className="card-sub">
                Meta מאפשרת לעסק לפתוח שיחה רק בתבנית שאושרה מראש. יוצרים אותן ב-WhatsApp Manager בדיוק בשמות האלה; הנוסח המלא נמצא ב-<Env name="docs/WHATSAPP-SETUP.md" />.
              </div>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>למה משמשת</th>
                  <th>שם התבנית</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['קוד לאיפוס סיסמה', env.whatsappTemplates.otp],
                  ['קישור למסמכים ללקוח', env.whatsappTemplates.documents],
                  ['תזכורת למשימה', env.whatsappTemplates.reminder],
                  ['משימה חדשה שהוקצתה', env.whatsappTemplates.taskAssigned],
                  ['התראה על הודעה בצ׳אט', env.whatsappTemplates.chat],
                ].map(([use, name]) => (
                  <tr key={name}>
                    <td className="small">{use}</td>
                    <td className="mono small">{name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small ink-2" style={{ margin: '12px 0 0' }}>
            כתובת ה-Webhook לעדכוני מסירה (ב-Meta: Configuration → Webhook): <code className="env">{webhookUrl}</code>, עם ה-Verify token מ-<Env name="WHATSAPP_VERIFY_TOKEN" />.
          </p>
        </section>
      </div>
    </>
  );
}
