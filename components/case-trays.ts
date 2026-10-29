// The "trays" on the Today screen and the matching filters on /cases, plus the
// four phases a case moves through. One definition, so a tray's count always
// equals the number of cases its link shows.
import { isUnderInvestigation, type CaseStage, type DecisionStatus, type InvestigationOutcome } from '@/lib/domain';

type TrayCase = {
  stage: CaseStage;
  missingItems: number;
  troubleFlag?: boolean;
  decisionStatus?: DecisionStatus;
  investigationOutcome?: InvestigationOutcome;
};

export type TrayId = 'missing' | 'ready' | 'office' | 'payment' | 'flagged';

export const TRAYS: { id: TrayId; label: string; hint: string; tone: 'red' | 'amber' | 'accent' | 'green' | '' }[] = [
  { id: 'missing', label: 'מסמכים חסרים', hint: 'לבקש מהלקוחות', tone: 'red' },
  { id: 'ready', label: 'מוכן להגשה', hint: 'לשלוח ללקוח או להגיש', tone: 'accent' },
  { id: 'office', label: 'ממתין למשרד', hint: 'הוגש, מחכים לתשובה', tone: '' },
  { id: 'payment', label: 'ממתין לתשלום', hint: 'לגבות שכר טרחה', tone: 'amber' },
  { id: 'flagged', label: 'מסומנים', hint: 'תקועים או בבירור', tone: 'red' },
];

export function inTray(c: TrayCase, tray: TrayId) {
  if (c.stage === 'closed') return false;
  switch (tray) {
    case 'missing':
      return c.missingItems > 0 || c.stage === 'action-required';
    case 'ready':
      return c.stage === 'ready-for-client' || c.stage === 'sent-to-client';
    case 'office':
      return c.stage === 'submitted' || c.stage === 'in-government-review';
    case 'payment':
      return c.stage === 'awaiting-payment';
    case 'flagged':
      return Boolean(c.troubleFlag) || isUnderInvestigation(c);
  }
}

export type PhaseId = 'intake' | 'submit' | 'office' | 'finish';

export const PHASES: { id: PhaseId; label: string; stages: CaseStage[] }[] = [
  { id: 'intake', label: 'קליטה ומסמכים', stages: ['new-client', 'collecting-documents', 'documents-review'] },
  { id: 'submit', label: 'הכנה והגשה', stages: ['ready-for-client', 'sent-to-client', 'submitted'] },
  { id: 'office', label: 'בטיפול המשרד', stages: ['in-government-review', 'action-required', 'decision-received'] },
  { id: 'finish', label: 'תשלום וסגירה', stages: ['awaiting-payment', 'closed'] },
];

export function phaseOf(stage: CaseStage): PhaseId {
  return PHASES.find((p) => p.stages.includes(stage))?.id ?? 'intake';
}
