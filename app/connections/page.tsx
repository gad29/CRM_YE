import { env, hasAdminPassword, hasResendConfig, hasWhatsAppConfig } from '@/lib/env';
import { IntegrationTools } from '@/components/integration-tools';

export const dynamic = 'force-dynamic';

function StatusBadge({ ok, okText, missingText }: { ok: boolean; okText: string; missingText: string }) {
  return <span className={`badge ${ok ? 'good' : 'warn'}`}>{ok ? `✓ ${okText}` : `○ ${missingText}`}</span>;
}

function Env({ name }: { name: string }) {
  return <code dir="ltr">{name}</code>;
}

export default function ConnectionsPage() {
  const email = hasResendConfig();
  const whatsapp = hasWhatsAppConfig();
  const webhookUrl = `${env.appBaseUrl}/api/webhooks/whatsapp`;

  return (
    <div>
      <div className="hero">
        <div>
          <p className="eyebrow">חיבורים</p>
          <h1 style={{ margin: '6px 0 4px' }}>אימייל, וואטסאפ ותזכורות</h1>
          <p className="muted" style={{ margin: 0 }}>
            המערכת שולחת בעצמה: אימיילים דרך Resend והודעות וואטסאפ דרך Meta. המפתחות נשמרים בקובץ ההגדרות של השרת בלבד.
          </p>
        </div>
      </div>

      <div className="connection-grid" style={{ marginBottom: 20 }}>
        <div className="connection-card">
          <div className="split connection-topline">
            <strong>אימייל (Resend)</strong>
            <StatusBadge ok={email} okText="מחובר" missingText="לא מוגדר" />
          </div>
          <p className="connection-value" dir="ltr" style={{ fontSize: 14 }}>
            {env.emailFrom || 'EMAIL_FROM not set'}
          </p>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            נדרש: <Env name="RESEND_API_KEY" /> ו-<Env name="EMAIL_FROM" /> מדומיין שאומת ב-Resend.
          </p>
        </div>

        <div className="connection-card">
          <div className="split connection-topline">
            <strong>וואטסאפ (Meta Cloud API)</strong>
            <StatusBadge ok={whatsapp} okText="מחובר" missingText="לא מוגדר" />
          </div>
          <p className="connection-value" dir="ltr" style={{ fontSize: 14 }}>
            {env.whatsappPhoneNumberId ? `Phone number ID ${env.whatsappPhoneNumberId}` : 'WHATSAPP_PHONE_NUMBER_ID not set'}
          </p>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            נדרש: <Env name="WHATSAPP_ACCESS_TOKEN" /> ו-<Env name="WHATSAPP_PHONE_NUMBER_ID" />. כל הודעה יוצאת דרך תבנית שאושרה ב-Meta
            (שפה: <Env name={env.whatsappTemplateLang} />).
          </p>
        </div>

        <div className="connection-card">
          <div className="split connection-topline">
            <strong>תזכורות משימות</strong>
            <StatusBadge ok={email || whatsapp} okText="פעיל" missingText="אין ערוץ שליחה" />
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            המערכת בודקת כל דקה אילו תזכורות הגיע זמנן ושולחת כל תזכורת פעם אחת בדיוק, בערוצים שנבחרו במשימה. אם השליחה נכשלת — עד 3
            ניסיונות.
          </p>
        </div>

        <div className="connection-card">
          <div className="split connection-topline">
            <strong>אבטחת מנהל</strong>
            <StatusBadge ok={hasAdminPassword()} okText="סיסמה מוגדרת" missingText="ללא סיסמה!" />
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            הכניסה מוגנת מפני ניחוש סיסמאות (נעילה זמנית אחרי ניסיונות שגויים), וכל התחברות נשמרת בשרת — השבתת עובד או החלפת סיסמה
            מנתקת אותו מיד.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>תבניות וואטסאפ</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          Meta מאפשרת לעסק לפתוח שיחה רק באמצעות תבניות מאושרות מראש. אלה שמות התבניות שהמערכת משתמשת בהן — יש ליצור אותן ב-WhatsApp
          Manager בדיוק בשמות האלה (הנוסח המלא נמצא ב-<Env name="docs/WHATSAPP-SETUP.md" />).
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>שימוש</th>
              <th>שם תבנית</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['קוד איפוס סיסמה (Authentication)', env.whatsappTemplates.otp],
              ['קישור למסמכים ללקוח', env.whatsappTemplates.documents],
              ['תזכורת משימה', env.whatsappTemplates.reminder],
              ['משימה חדשה שויכה', env.whatsappTemplates.taskAssigned],
              ['התראה על הודעת צ׳אט', env.whatsappTemplates.chat],
            ].map(([use, name]) => (
              <tr key={name}>
                <td style={{ fontSize: 13 }}>{use}</td>
                <td dir="ltr" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{name}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          כתובת Webhook לעדכוני מסירה (Meta → Configuration → Webhook): <code dir="ltr">{webhookUrl}</code>, עם ה-Verify token שהוגדר
          ב-<Env name="WHATSAPP_VERIFY_TOKEN" />.
        </p>
      </div>

      <IntegrationTools emailReady={email} whatsappReady={whatsapp} />
    </div>
  );
}
