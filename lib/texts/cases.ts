import type { TextDef } from './index';

/** The case page: the "next step" panel, its buttons, tabs and menus. */
export const CASE_TEXTS: TextDef[] = [
  // Panel frame
  { key: 'case.nextStep', value: 'השלב הבא', note: 'כותרת הפאנל בדף התיק' },
  { key: 'case.advance', value: 'מעבר ל{stage}', note: 'כפתור המעבר לשלב הבא כשאין לו ניסוח משלו; {stage} = שם השלב' },
  { key: 'case.back', value: 'חזרה ל{stage}', note: 'כפתור החזרה בשלב שנוסף בהגדרות; {stage} = שם השלב' },
  { key: 'case.customBody', value: 'כשמסיימים את מה שצריך בשלב הזה, מעבירים את התיק הלאה.', note: 'השלב הבא, בשלב שנוסף בהגדרות ואין לו הנחיה' },
  { key: 'case.closeCase', value: 'סגירת התיק', note: 'השלב הבא, ובחלון האישור' },

  // Investigation
  { key: 'case.inv.title', value: 'התיק בחקירה — ממתינים למסקנה', note: 'השלב הבא, כשהתיק בחקירה' },
  { key: 'case.inv.body', value: 'כשהמשרד מודיע על תוצאת החקירה, עדכנו כאן.', note: 'השלב הבא, כשהתיק בחקירה' },
  { key: 'case.inv.approved', value: 'החקירה הסתיימה באישור', note: 'כפתור, כשהתיק בחקירה' },
  { key: 'case.inv.rejected', value: 'הבקשה נדחתה', note: 'כפתור, כשהתיק בחקירה' },

  // Collecting documents
  { key: 'case.docs.missingOne', value: 'חסר מסמך אחד מהלקוח', note: 'השלב הבא, באיסוף מסמכים' },
  { key: 'case.docs.missingMany', value: 'חסרים {n} מסמכים מהלקוח', note: 'השלב הבא, באיסוף מסמכים; {n} = מספר' },
  { key: 'case.docs.requestWhatsapp', value: 'בקשת המסמכים בוואטסאפ', note: 'כפתור באיסוף מסמכים' },
  { key: 'case.docs.requestMail', value: 'בקשה במייל', note: 'כפתור באיסוף מסמכים' },
  { key: 'case.docs.upload', value: 'העלאת מסמכים שהתקבלו', note: 'כפתור באיסוף מסמכים' },
  { key: 'case.docs.markCollecting', value: 'סימון: באיסוף מסמכים', note: 'כפתור בתיק חדש' },
  { key: 'case.docs.allArrived', value: 'כל המסמכים התקבלו', note: 'השלב הבא, כשלא חסר כלום' },
  { key: 'case.docs.allArrivedBody', value: 'הגיע הזמן לעבור עליהם ולוודא שהכול תקין.' },
  { key: 'case.docs.noList', value: 'אין רשימת מסמכים לתיק', note: 'השלב הבא, כשאין רשימת מסמכים' },
  { key: 'case.docs.noListBody', value: 'אפשר להוסיף מסמכים נדרשים בלשונית המסמכים, או להמשיך ישר לבדיקה.' },
  { key: 'case.docs.toReview', value: 'מעבר לבדיקת המסמכים', note: 'כפתור כשכל המסמכים התקבלו' },

  // Reviewing documents
  { key: 'case.review.titleOne', value: 'לבדוק מסמך אחד ולאשר', note: 'השלב הבא, בבדיקת מסמכים' },
  { key: 'case.review.titleMany', value: 'לבדוק {n} מסמכים ולאשר', note: 'השלב הבא, בבדיקת מסמכים; {n} = מספר' },
  { key: 'case.review.done', value: 'המסמכים נבדקו', note: 'השלב הבא, בבדיקת מסמכים' },
  { key: 'case.review.body', value: 'סמנו כל מסמך כ"אושר" או "נדרש מחדש". כשהכול תקין — מכינים את הבקשה לשליחה ללקוח.' },
  { key: 'case.review.ok', value: 'המסמכים תקינים — מוכן ללקוח', note: 'כפתור בבדיקת מסמכים' },
  { key: 'case.review.toList', value: 'לרשימת המסמכים', note: 'כפתור בבדיקת מסמכים' },
  { key: 'case.review.back', value: 'חסר משהו — חזרה לאיסוף', note: 'כפתור בבדיקת מסמכים' },

  // Ready for the client / sent to the client
  { key: 'case.ready.title', value: 'לשלוח ללקוח את הבקשה המוכנה', note: 'השלב הבא, במוכן לשליחה' },
  { key: 'case.ready.body', value: 'בחרו בלשונית המסמכים את הקבצים לשליחה, ושלחו ללקוח בקישור אחד במייל או בוואטסאפ.' },
  { key: 'case.ready.markSent', value: 'סימון: נשלח ללקוח', note: 'כפתור במוכן לשליחה' },
  { key: 'case.ready.pick', value: 'בחירת מסמכים לשליחה', note: 'כפתור במוכן לשליחה' },
  { key: 'case.sent.title', value: 'כשהלקוח מאשר — מגישים למשרד', note: 'השלב הבא, אחרי השליחה ללקוח' },
  { key: 'case.sent.body', value: 'אחרי ההגשה רשמו את מספר התיק שהמשרד נתן, כדי שיהיה בהישג יד בכל שיחה.' },
  { key: 'case.sent.markSubmitted', value: 'סימון: הוגש למשרד', note: 'כפתור, ובחלון ההגשה' },
  { key: 'case.sent.dialogTitle', value: 'הגשה למשרד', note: 'כותרת חלון ההגשה' },

  // At the office
  { key: 'case.office.title', value: 'ממתינים לתשובת המשרד', note: 'השלב הבא, אחרי ההגשה' },
  { key: 'case.office.body', value: 'מה המשרד השיב?', note: 'השלב הבא, אחרי ההגשה' },
  { key: 'case.office.approved', value: 'המשרד אישר', note: 'כפתור אחרי ההגשה' },
  { key: 'case.office.needsMore', value: 'ביקשו השלמה', note: 'כפתור אחרי ההגשה' },
  { key: 'case.office.investigation', value: 'הועבר לחקירה', note: 'כפתור אחרי ההגשה' },
  { key: 'case.office.markReview', value: 'סימון: בטיפול המשרד', note: 'כפתור אחרי ההגשה' },
  { key: 'case.ask.approvedTitle', value: 'המשרד אישר את הבקשה', note: 'כותרת חלון האישור' },
  { key: 'case.ask.approvedConfirm', value: 'אישור — מעבר לתשלום', note: 'כפתור בחלון האישור' },
  { key: 'case.ask.needsMoreTitle', value: 'המשרד ביקש השלמה', note: 'כותרת חלון ההשלמה' },
  { key: 'case.ask.needsMoreLabel', value: 'מה המשרד ביקש להשלים?', note: 'שדה בחלון ההשלמה' },

  // Office asked for more
  { key: 'case.action.title', value: 'המשרד ביקש השלמה', note: 'השלב הבא, בנדרשת השלמה' },
  { key: 'case.action.body', value: 'שלחו למשרד את מה שביקש, ועדכנו כאן.' },
  { key: 'case.action.sent', value: 'ההשלמה נשלחה למשרד', note: 'כפתור בנדרשת השלמה' },
  { key: 'case.action.update', value: 'עדכון הבקשה', note: 'כפתור בנדרשת השלמה' },

  // Decision
  { key: 'case.decision.rejectedTitle', value: 'הבקשה נדחתה', note: 'השלב הבא, אחרי דחייה' },
  { key: 'case.decision.rejectedBody', value: 'אם אין מה לערער — סגרו את התיק.' },
  { key: 'case.decision.approvedTitle', value: 'הבקשה אושרה', note: 'השלב הבא, אחרי אישור' },
  { key: 'case.decision.approvedBody', value: 'נשאר לגבות את שכר הטרחה.' },
  { key: 'case.decision.toPayment', value: 'מעבר לתשלום', note: 'כפתור אחרי אישור' },
  { key: 'case.decision.askTitle', value: 'מה החליט המשרד?', note: 'השלב הבא, בהתקבלה החלטה' },
  { key: 'case.decision.approved', value: 'אושר', note: 'כפתור בהתקבלה החלטה' },

  // Payment
  { key: 'case.pay.workerTitle', value: 'הבקשה אושרה — ממתין לתשלום', note: 'השלב הבא לעובד, בממתין לתשלום' },
  { key: 'case.pay.workerBody', value: 'הגבייה אצל המנהל. כשהתשלום מתקבל, התיק נסגר.' },
  { key: 'case.pay.remaining', value: 'נשאר לגבות {amount}', note: 'השלב הבא, בממתין לתשלום; {amount} = סכום' },
  { key: 'case.pay.receivedTitle', value: 'התשלום התקבל', note: 'השלב הבא, כשהכול שולם' },
  { key: 'case.pay.receivedBody', value: 'הכול הושלם — אפשר לסגור את התיק.' },
  { key: 'case.recordPayment', value: 'רישום תשלום', note: 'בתיק ובמסך התשלומים' },

  // Closed
  { key: 'case.closed.title', value: 'התיק סגור', note: 'השלב הבא, בתיק סגור' },
  { key: 'case.closed.body', value: 'אם צריך לחזור אליו — בחרו שלב במסלול למעלה.' },
  { key: 'case.newCaseForClient', value: 'תיק חדש ללקוח', note: 'כפתור בתיק סגור' },

  // Header menu and flag
  { key: 'case.menu.transfer', value: 'העברת התיק לאחר', note: 'תפריט הפעולות בראש התיק' },
  { key: 'case.menu.transferToManager', value: 'העברה למנהל', note: 'תפריט הפעולות, לעובד' },
  { key: 'case.flag', value: 'סימון התיק כתקוע', note: 'תפריט הפעולות בראש התיק' },
  { key: 'case.menu.unflag', value: 'הסרת סימון "תקוע"', note: 'תפריט הפעולות בראש התיק' },
  { key: 'case.menu.anotherCase', value: 'תיק נוסף ללקוח', note: 'תפריט הפעולות בראש התיק' },
  { key: 'case.menu.delete', value: 'מחיקת התיק', note: 'תפריט הפעולות בראש התיק' },
  { key: 'case.flaggedBanner', value: 'התיק מסומן כתקוע', note: 'הפס האדום מתחת לכותרת' },
  { key: 'case.unflag', value: 'הסרת הסימון', note: 'כפתור בפס האדום' },

  // Tabs
  { key: 'case.tab.documents', value: 'מסמכים', note: 'לשונית בדף התיק' },
  { key: 'case.tab.payments', value: 'תשלומים', note: 'לשונית בדף התיק' },
  { key: 'case.tab.details', value: 'פרטי התיק', note: 'לשונית בדף התיק, וכותרת הכרטיס' },
  { key: 'case.tab.history', value: 'היסטוריה', note: 'לשונית בדף התיק' },

  // Details card
  { key: 'case.title', value: 'נושא התיק', note: 'שם השדה בעריכת פרטי התיק' },
  { key: 'case.titleShort', value: 'נושא', note: 'בכרטיס פרטי התיק' },
  { key: 'case.nextAction', value: 'פעולה הבאה', note: 'בכרטיס פרטי התיק' },
  { key: 'case.decisionText', value: 'החלטת המשרד', note: 'בכרטיס פרטי התיק' },
  { key: 'case.notes', value: 'הערות', note: 'בכרטיס פרטי התיק' },
  { key: 'case.edit', value: 'עריכה', note: 'כפתור בכרטיס פרטי התיק' },
  { key: 'case.editTitle', value: 'עריכת פרטי התיק', note: 'כותרת טופס העריכה' },
  { key: 'case.save', value: 'שמירת הפרטים', note: 'כפתור בטופס העריכה' },
];
