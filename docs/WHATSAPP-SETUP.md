# חיבור וואטסאפ (Meta WhatsApp Cloud API)

המערכת שולחת וואטסאפ ישירות דרך ה-API הרשמי של Meta — בלי שירותי ביניים.
המדריך הזה מסביר מה צריך לפתוח אצל Meta, אילו תבניות ליצור, ואיזה ערכים לשים
בקובץ ההגדרות של השרת.

> **למה תבניות?** Meta מאפשרת לעסק לפתוח שיחה (תזכורת, קוד, קישור למסמכים)
> רק באמצעות **תבנית שאושרה מראש**. הודעה חופשית אפשר לשלוח רק תוך 24 שעות
> מהודעה שהלקוח עצמו שלח. לכן כל הודעה שהמערכת יוזמת יוצאת דרך אחת מחמש
> התבניות שלמטה.

---

## 1. מה צריך לפני שמתחילים

- חשבון **Meta Business** (business.facebook.com) על שם העסק.
- **מספר טלפון ייעודי** לשליחה. מספר שכבר פעיל באפליקציית WhatsApp / WhatsApp Business
  צריך להימחק ממנה קודם (או להשתמש במספר חדש).
- **אמצעי תשלום** בחשבון — Meta גובה לפי הודעה עבור תבניות Utility / Authentication
  (המחירים העדכניים באתר של Meta, תחת WhatsApp Business Platform pricing).

## 2. יצירת האפליקציה והמספר

1. developers.facebook.com → **My Apps → Create App** → סוג **Business** → לחבר לחשבון ה-Business.
2. בתוך האפליקציה: **Add product → WhatsApp → Set up**.
3. **WhatsApp → API Setup**: להוסיף את מספר הטלפון של העסק ולאמת אותו (SMS/שיחה).
4. להעתיק משם את **Phone number ID** (מספר ארוך — לא מספר הטלפון עצמו).

## 3. טוקן קבוע (לא הזמני!)

הטוקן שמופיע בדף API Setup פג אחרי 24 שעות. צריך טוקן של **System User**:

1. business.facebook.com → **Business settings → Users → System users → Add** (תפקיד Admin).
2. **Add assets** → לבחור את האפליקציה ואת חשבון ה-WhatsApp (Full control).
3. **Generate new token** → לבחור את האפליקציה, תוקף **Never**, והרשאות:
   `whatsapp_business_messaging`, `whatsapp_business_management`.
4. לשמור את הטוקן — הוא מוצג פעם אחת.

## 4. התבניות

ב-**WhatsApp Manager → Message templates → Create template**. השמות חייבים להיות
בדיוק כמו כאן (או לשנות את השמות בקובץ ההגדרות — ראו סעיף 6). שפה: **Hebrew (he)**.

> הסדר של `{{1}}`, `{{2}}`… חשוב — המערכת ממלאת אותם בדיוק בסדר הזה.

### `crmye_password_reset` — קוד איפוס סיסמה
- **Category:** Authentication
- Meta מספקת את הנוסח בעצמה. לסמן **Copy code** כסוג הכפתור, ולהפעיל
  "Add security recommendation" ו-"Add expiry time" (15 דקות).

### `crmye_documents_link` — קישור למסמכים ללקוח
- **Category:** Utility
- **Body:**
  ```
  שלום {{1}}, {{2}} שלח/ה לך {{3}}.
  לצפייה ולהורדה מאובטחת: {{4}}
  הקישור בתוקף ל-{{5}} ימים.
  ```
- דוגמאות לאישור: `ישראל ישראלי` · `משרד יעוץ` · `3 מסמכים` · `https://your-domain.co.il/api/share/abc` · `14`

### `crmye_task_reminder` — תזכורת משימה
- **Category:** Utility
- **Body:**
  ```
  שלום {{1}}, תזכורת: {{2}}
  מועד: {{3}}
  {{4}}
  לפרטים נכנסים למערכת.
  ```
- דוגמאות: `רחל` · `להתקשר למילגם` · `14/10/2026, 10:00` · `לקוח: ישראל ישראלי · תיק: סיוע בשכר דירה`

### `crmye_task_assigned` — משימה חדשה שויכה
- **Category:** Utility
- **Body:**
  ```
  שלום {{1}}, שויכה אליך משימה חדשה: {{2}}
  מועד: {{3}}
  לפרטים נכנסים למערכת.
  ```
- דוגמאות: `רחל` · `לבדוק מסמכים של משפחת כהן` · `14/10/2026, 10:00`

### `crmye_chat_message` — התראה על הודעת צ׳אט
- **Category:** Utility
- **Body:**
  ```
  שלום {{1}}, התקבלה הודעה חדשה מ{{2}} בצ׳אט הצוות:
  {{3}}
  לקריאה ומענה נכנסים למערכת.
  ```
- דוגמאות: `רחל` · `מנהל ראשי` · `אפשר לעבור על התיק של כהן?`

האישור לוקח בדרך כלל מכמה דקות עד יום. רק תבנית בסטטוס **Active** ניתנת לשליחה.

## 5. Webhook לעדכוני מסירה (מומלץ)

כך דף **חיבורים** במערכת יראה אם ההודעה נמסרה / נקראה / נכשלה.

1. ב-**App settings → Basic** להעתיק את **App secret**.
2. **WhatsApp → Configuration → Webhook → Edit**:
   - Callback URL: `https://<הדומיין-שלכם>/api/webhooks/whatsapp`
   - Verify token: מחרוזת אקראית כלשהי — אותה מחרוזת שתכניסו ל-`WHATSAPP_VERIFY_TOKEN`.
3. **Webhook fields → messages → Subscribe**.

(צריך שהמערכת כבר תרוץ עם ההגדרות של סעיף 6 לפני שלוחצים Verify.)

## 6. ההגדרות בשרת

בקובץ ההגדרות (`.env` בהתקנת Docker, או `.env.production.local` בהתקנת pm2):

```ini
WHATSAPP_ACCESS_TOKEN=<הטוקן הקבוע מסעיף 3>
WHATSAPP_PHONE_NUMBER_ID=<Phone number ID מסעיף 2>
WHATSAPP_APP_SECRET=<App secret מסעיף 5>
WHATSAPP_VERIFY_TOKEN=<המחרוזת שבחרתם בסעיף 5>
WHATSAPP_TEMPLATE_LANG=he
# רק אם נתתם לתבניות שמות אחרים:
# WHATSAPP_TEMPLATE_OTP=crmye_password_reset
# WHATSAPP_TEMPLATE_DOCUMENTS=crmye_documents_link
# WHATSAPP_TEMPLATE_REMINDER=crmye_task_reminder
# WHATSAPP_TEMPLATE_TASK_ASSIGNED=crmye_task_assigned
# WHATSAPP_TEMPLATE_CHAT=crmye_chat_message
```

אחרי שמירה — להפעיל מחדש את האפליקציה (ראו DEPLOY.md), ואז בדף **חיבורים**
במערכת: "שליחת בדיקה" למספר הנייד שלכם. הודעת הבדיקה משתמשת בתבנית התזכורות,
כך שאם היא מגיעה — גם התזכורות יגיעו.

## תקלות נפוצות

| הודעת שגיאה בדף חיבורים | פירוש |
|---|---|
| `(132001) template … not found` | שם התבנית או השפה לא תואמים, או שהתבנית עוד לא אושרה |
| `(132000) number of parameters does not match` | מספר ה-`{{n}}` בתבנית שונה ממה שמופיע במדריך |
| `(190) … access token` | הטוקן פג (כנראה הטוקן הזמני) — ליצור טוקן System User |
| `(131030) recipient not in allowed list` | האפליקציה עדיין במצב פיתוח — להוסיף אמצעי תשלום / לעבור ל-Live |
| `(131026) message undeliverable` | למספר אין וואטסאפ, או שהוא חסם את העסק |

מספרים מקומיים (`050-1234567`) מומרים אוטומטית לפורמט בינלאומי (`972501234567`)
לפי `DEFAULT_COUNTRY_CODE` (ברירת מחדל 972).
