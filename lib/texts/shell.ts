import type { TextDef } from './index';

/** Navigation, page titles and the buttons shared across screens. */
export const SHELL_TEXTS: TextDef[] = [
  { key: 'nav.today', value: 'היום', note: 'תפריט' },
  { key: 'nav.clients', value: 'לקוחות', note: 'תפריט' },
  { key: 'nav.cases', value: 'תיקים', note: 'תפריט' },
  { key: 'nav.tasks', value: 'משימות', note: 'תפריט' },
  { key: 'nav.chat', value: 'צ׳אט צוות', note: 'תפריט' },
  { key: 'nav.payments', value: 'תשלומים וגבייה', note: 'תפריט' },
  { key: 'nav.groupMoney', value: 'כספים', note: 'כותרת בתפריט' },
  { key: 'nav.groupAdmin', value: 'ניהול המערכת', note: 'כותרת בתפריט' },
  { key: 'btn.newClient', value: 'לקוח חדש', note: 'הכפתור בראש כל מסך, ברשימת הלקוחות ובכותרת החלון' },
  { key: 'btn.newCase', value: 'תיק חדש', note: 'כרטיס התיק החדש ובכותרת החלון' },
  { key: 'btn.remind', value: 'תזכורת לבדוק', note: 'ליד השלב הבא ובכרטיסי לקוח' },
];
