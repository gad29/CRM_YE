import type { TextDef } from './index';

/** The case page: the "next step" panel, its buttons, tabs and menus. */
export const CASE_TEXTS: TextDef[] = [
  { key: 'case.title', value: 'כותרת התיק', note: 'שם השדה בטופס התיק' },
  { key: 'case.nextStep', value: 'השלב הבא', note: 'כותרת הפאנל בדף התיק' },
  { key: 'case.advance', value: 'מעבר ל{stage}', note: 'כפתור המעבר לשלב הבא; {stage} = שם השלב' },
  { key: 'case.closeCase', value: 'סגירת התיק' },
  { key: 'case.flag', value: 'סימון התיק כתקוע' },
];
