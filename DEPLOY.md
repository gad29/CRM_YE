# התקנה, העברה וגיבוי — CRM_YE

המערכת רצה על כל שרת לינוקס, עם כל דומיין. שלושה מסלולים:

| מצב | מסלול |
|---|---|
| שרת חדש ונקי (מומלץ) | **[א. התקנה עם Docker](#א-התקנה-עם-docker-שרת-חדש)** — אפליקציה + PostgreSQL + HTTPS אוטומטי |
| שרת עם CloudPanel / pm2 | **[ב. התקנה עם pm2](#ב-התקנה-עם-pm2-cloudpanel)** |
| המערכת הישנה (קבצי JSON) כבר עובדת | **[ג. העברת הנתונים הקיימים](#ג-העברת-הנתונים-הקיימים)** |

ובנוסף: [ד. אימייל (Resend)](#ד-אימייל--resend) · [ה. וואטסאפ](docs/WHATSAPP-SETUP.md) ·
[ו. גיבויים](#ו-גיבויים) · [ז. עדכון גרסה](#ז-עדכון-גרסה) · [ח. תקלות](#ח-תקלות)

---

## א. התקנה עם Docker (שרת חדש)

**דרישות:** שרת Ubuntu/Debian עם גישת root, 2GB RAM, ודומיין (או תת-דומיין) שבשליטתכם.

### 1. DNS
אצל ספק הדומיין: רשומת **A** מהדומיין (למשל `crm.example.co.il`) לכתובת ה-IP של השרת.
בדיקה: `ping crm.example.co.il` מחזיר את ה-IP.

### 2. התקנת Docker
```bash
curl -fsSL https://get.docker.com | sh
```

### 3. הורדת המערכת
```bash
git clone https://github.com/gad29/CRM_YE.git /opt/crmye
cd /opt/crmye
cp .env.example .env
nano .env
```

למלא ב-`.env` לפחות:
```ini
DOMAIN=crm.example.co.il              # בלי https://
POSTGRES_PASSWORD=<openssl rand -hex 24>
ADMIN_PASSWORD=<סיסמה חזקה>
ADMIN_EMAIL=<האימייל של המנהל>
ADMIN_SESSION_SECRET=<openssl rand -hex 32>
```
(את `APP_BASE_URL` ו-`DATABASE_URL` Docker ממלא לבד.)

> **חשבון הבעלים:** בהפעלה הראשונה נוצר חשבון "בעלים" מ-`ADMIN_EMAIL` ו-`ADMIN_PASSWORD`, ונכנסים איתם
> (אימייל + סיסמה, כמו כל עובד). אחר כך הסיסמה מנוהלת בתוך המערכת (**החשבון שלי**), ושאר הצוות —
> מנהלים ועובדים — נוסף בדף **צוות והרשאות**. רק הבעלים יכול להוסיף מנהלים; מנהל מנהל עובדים בלבד.

> **סיסמה מוצפנת (bcrypt) ב-Docker:** ב-`.env` של Docker הסימן `$` מתפרש כמשתנה, לכן
> `ADMIN_PASSWORD_HASH` חייב להיות בגרשיים בודדים: `ADMIN_PASSWORD_HASH='$2a$12$...'`

### 4. הפעלה
```bash
docker compose up -d --build
docker compose logs -f app      # לחכות ל-"Ready", ואז Ctrl+C
```
גולשים ל-`https://crm.example.co.il` — התעודה (HTTPS) נוצרת אוטומטית בכניסה הראשונה.

**איפה הנתונים:** מסד הנתונים ב-volume של Docker; המסמכים בתיקייה `/opt/crmye/data`;
הגיבויים ב-`/opt/crmye/backups`.

### 5. גיבוי לילי
```bash
crontab -e
```
```cron
30 2 * * * cd /opt/crmye && docker compose exec -T app bash scripts/backup.sh /app/backups >> /var/log/crmye-backup.log 2>&1
```
ראו [ו. גיבויים](#ו-גיבויים) — ובמיוחד: להעתיק את הגיבויים גם **מחוץ לשרת**.

---

## ב. התקנה עם pm2 (CloudPanel)

### 1. PostgreSQL
```bash
sudo apt install -y postgresql postgresql-client
sudo -u postgres psql -c "CREATE ROLE crmye LOGIN PASSWORD '<סיסמה-חזקה>';"
sudo -u postgres psql -c "CREATE DATABASE crmye OWNER crmye;"
```

### 2. אתר Node.js ב-CloudPanel
**Sites → Add Site → Create a Node.js Site**: הדומיין, Node.js 22, **App Port 3006**.
אחר כך **SSL/TLS → New Let's Encrypt Certificate**, ובלשונית **Vhost** בתוך `server {}`:
```nginx
client_max_body_size 30M;
```

### 3. קוד והגדרות
```bash
cd ~/htdocs/<הדומיין>
git clone https://github.com/gad29/CRM_YE.git .
cp .env.example .env.production.local
nano .env.production.local
```
למלא: `APP_BASE_URL=https://<הדומיין>`, `DATABASE_URL=postgresql://crmye:<סיסמה>@localhost:5432/crmye`,
`ADMIN_PASSWORD`, `ADMIN_EMAIL`, `ADMIN_SESSION_SECRET` (`openssl rand -hex 32`), `CLIENT_IP_HEADER=x-real-ip`.

### 4. בנייה והפעלה
```bash
npm ci
npm run build
pm2 start ecosystem.config.cjs      # npm start מריץ קודם את עדכוני מסד הנתונים
pm2 save && pm2 startup
```

### 5. גיבוי לילי
```bash
crontab -e
```
```cron
30 2 * * * cd ~/htdocs/<הדומיין> && bash scripts/backup.sh ~/backups >> ~/backups/backup.log 2>&1
```

> **אבטחה:** אם השרת יצא לפעולה עם הגדרה לא בטוחה (בלי סיסמה, סוד קצר מ-32 תווים,
> כתובת בלי https) — המערכת **מסרבת לעלות** ומדפיסה ב-`pm2 logs crmye` מה לתקן.

---

## ג. העברת הנתונים הקיימים

### ג1. מהגרסה הישנה (קבצי JSON) לגרסה החדשה

הייבוא **רק קורא** את קבצי ה-JSON — לא משנה, לא מוחק ולא מזיז אותם. הכל קורה
בטרנזקציה אחת: אחרי ההכנסה כל רשומה נקראת חזרה ומושווית שדה-שדה למקור,
ו**כל הבדל מבטל את כל הייבוא**. יש גם מצב חזרה גנרלית (`--dry-run`) שלא שומר כלום.

**על אותו שרת (CloudPanel / pm2):**
```bash
cd ~/htdocs/<הדומיין>

# 0. גיבוי טרי של המצב הקיים (בנוסף לכל גיבוי אחר)
tar -czf ~/crmye-before-postgres-$(date +%F).tar.gz data .env.production.local

# 1. PostgreSQL — כמו בסעיף ב1, ולהוסיף DATABASE_URL ל-.env.production.local
#    ולוודא ש-ADMIN_SESSION_SECRET באורך 32 תווים לפחות (אחרת המערכת לא תעלה)

# 2. הקוד החדש
git pull
npm ci
npm run build

# 3. חזרה גנרלית — לא נשמר כלום
npm run db:import-json:dry-run

# 4. מכאן ההשבתה מתחילה (כ-2 דקות): עוצרים כדי שלא ייכתבו נתונים חדשים ל-JSON
pm2 stop crmye
npm run db:import-json
pm2 restart crmye
```
הפלט מציג לכל טבלה: כמה ב-JSON, כמה במסד, וכמה זהות לחלוטין. ההשבתה בפועל — רק בין שלב 4 לסוף.

**לשרת חדש עם Docker:** מתקינים לפי סעיף א (עד שלב 4), ואז:
```bash
# בשרת הישן: לעצור את המערכת ולארוז את תיקיית data כולה
pm2 stop crmye
tar -czf crmye-data.tar.gz -C ~/htdocs/<הדומיין-הישן> data

# להעביר לשרת החדש ולפרוס לתוך /opt/crmye/data
scp crmye-data.tar.gz root@<שרת-חדש>:/opt/crmye/
ssh root@<שרת-חדש>
cd /opt/crmye && tar -xzf crmye-data.tar.gz          # יוצר/ממלא את ./data

docker compose run --rm app node scripts/import-json.mjs --dry-run
docker compose run --rm app node scripts/import-json.mjs
docker compose restart app
```

### ג2. בין שני שרתים שכבר רצים על הגרסה החדשה

גיבוי אחד = העברה אחת. בשרת הישן:
```bash
bash scripts/backup.sh ~/transfer            # pm2
# או:  docker compose exec -T app bash scripts/backup.sh /app/backups   (Docker)
```
מעתיקים את התיקייה `crmye-<תאריך>` לשרת החדש, ושם (אחרי התקנה לפי א או ב):
```bash
bash scripts/restore.sh <התיקייה>                                       # pm2
# או:  docker compose exec -T app bash scripts/restore.sh /app/backups/crmye-<תאריך>   (Docker)
```
השחזור בודק checksums, מסרב לדרוס מערכת שכבר יש בה נתונים, ומשווה את מספר הרשומות לגיבוי.

### כדי שקישורים שכבר נשלחו ללקוחות ימשיכו לעבוד
קישורי ההורדה חתומים ב-`ADMIN_SESSION_SECRET`. מעבירים את **אותו ערך** לשרת החדש.
אם הדומיין משתנה — קישורים ישנים מצביעים לדומיין הישן; כדאי להשאיר אותו מפנה
(redirect) לחדש לשבועיים (תוקף קישור הוא 14 יום).

---

## ד. אימייל — Resend

1. נרשמים ב-resend.com.
2. **Domains → Add Domain** — הדומיין של העסק (מומלץ תת-דומיין כמו `mail.example.co.il`).
   מוסיפים אצל ספק ה-DNS את רשומות ה-TXT/MX ש-Resend מציג, ומחכים לסטטוס **Verified**.
3. **API Keys → Create** — הרשאת **Sending access** בלבד.
4. בקובץ ההגדרות:
   ```ini
   RESEND_API_KEY=re_...
   EMAIL_FROM=שם העסק <noreply@mail.example.co.il>
   EMAIL_REPLY_TO=<האימייל האמיתי של העסק>
   ```
5. הפעלה מחדש (Docker: `docker compose up -d` · pm2: `pm2 restart crmye`), ובדף
   **חיבורים** → "שליחת בדיקה".

## ה. וואטסאפ

מדריך מלא: **[docs/WHATSAPP-SETUP.md](docs/WHATSAPP-SETUP.md)** (חשבון Meta, טוקן קבוע,
חמש תבניות עם הנוסח המדויק, Webhook לעדכוני מסירה).

---

## ו. גיבויים

`scripts/backup.sh` יוצר תיקייה `crmye-<תאריך-שעה>` עם:
- `database.dump` — כל מסד הנתונים
- `files.tar.gz` — כל המסמכים, קבצי הצ׳אט והתבניות
- `MANIFEST.json` — מספר הרשומות בכל טבלה (נבדק שוב בשחזור)
- `SHA256SUMS` — לזיהוי קובץ פגום

ברירת מחדל: נשמרים 14 ימים (`KEEP_DAYS=30` לשינוי).

**חשוב:** גיבוי שנמצא רק על אותו שרת לא מגן מתקלת דיסק או מפריצה. להעתיק את
תיקיית הגיבויים באופן קבוע למקום אחר — שרת אחר (`rsync`), אחסון ענן (rclone ל-Google Drive /
S3 / R2), או לפחות הורדה ידנית שבועית.

**בדיקת שחזור** (פעם ברבעון): לשחזר את הגיבוי האחרון למסד נתונים ריק ולוודא שהוא עולה.

---

## ז. עדכון גרסה

**Docker:**
```bash
cd /opt/crmye && git pull && docker compose up -d --build
```
**pm2:**
```bash
cd ~/htdocs/<הדומיין> && git pull && npm ci && npm run build && pm2 restart crmye
```
עדכוני מסד הנתונים (migrations) רצים אוטומטית בכל הפעלה.

---

## ח. תקלות

| בעיה | בדיקה |
|---|---|
| האתר לא עולה | `docker compose logs app` / `pm2 logs crmye` — הודעת "refuses to start" מפרטת מה חסר |
| 502 | האפליקציה לא מאזינה: האם `DATABASE_URL` נכון ו-PostgreSQL רץ? `curl http://127.0.0.1:3006/api/health` |
| "יותר מדי ניסיונות כניסה" | נעילה זמנית של 15 דקות אחרי 8 סיסמאות שגויות לחשבון |
| שינוי `ADMIN_PASSWORD` לא משנה כלום | צפוי — הוא משמש רק ליצירת חשבון הבעלים בהפעלה הראשונה. מאז הסיסמה נקבעת בדף **החשבון שלי** |
| הבעלים שכח סיסמה ואין גישה לאימייל/וואטסאפ | על השרת: `npm run owner:reset` (ב-Docker: `docker compose exec app node scripts/reset-owner-password.mjs`) — מדפיס סיסמה זמנית אחת |
| העלאת קובץ נכשלת (413) | nginx: `client_max_body_size 30M` (סעיף ב2) |
| אימייל / וואטסאפ לא נשלחים | דף **חיבורים** → "הודעות אחרונות" מציג את סיבת הכשל |
| נעילת כניסה בכל ה-IP-ים יחד | `CLIENT_IP_HEADER` לא תואם לשרת: CloudPanel/nginx → `x-real-ip`, Caddy/Docker → `x-forwarded-for` |
