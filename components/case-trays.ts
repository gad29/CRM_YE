// The "trays" on the Today screen and the matching filters on /cases, plus the
// phases a case moves through. One definition, so a tray's count always
// equals the number of cases its link shows. Both follow Settings: tray names
// and which stage feeds which tray, phase names and which stages they hold.
import {
  DEFAULT_TRAYS,
  isUnderInvestigation,
  phaseGroups,
  phaseOfStage,
  stageDefs,
  stageTray,
  type AppConfig,
  type CaseStage,
  type DecisionStatus,
  type InvestigationOutcome,
  type PhaseId,
  type StageDef,
  type TrayDef,
  type TrayId,
} from '@/lib/domain';

export type { PhaseId, TrayId };

type TrayCase = {
  stage: CaseStage;
  missingItems: number;
  troubleFlag?: boolean;
  decisionStatus?: DecisionStatus;
  investigationOutcome?: InvestigationOutcome;
};

type TrayConfig = Partial<Pick<AppConfig, 'trays' | 'stages' | 'phases'>> | undefined;

const TRAY_TONES: Record<TrayId, 'red' | 'amber' | 'accent' | ''> = {
  missing: 'red',
  ready: 'accent',
  office: '',
  payment: 'amber',
  flagged: 'red',
};

/** The trays shown on Today, in order, with their tone. Hidden trays are left out. */
export function traysOf(config: TrayConfig): (TrayDef & { tone: 'red' | 'amber' | 'accent' | '' })[] {
  const list = config?.trays?.length ? config.trays : DEFAULT_TRAYS;
  return list.filter((t) => !t.hidden).map((t) => ({ ...t, tone: TRAY_TONES[t.id] }));
}

/** Every tray including hidden ones (for filters reached by an old link). */
export function trayDef(config: TrayConfig, id: TrayId) {
  const list = config?.trays?.length ? config.trays : DEFAULT_TRAYS;
  return list.find((t) => t.id === id);
}

export function inTray(c: TrayCase, tray: TrayId, config: TrayConfig) {
  if (c.stage === 'closed') return false;
  switch (tray) {
    case 'missing':
      return c.missingItems > 0 || c.stage === 'action-required';
    case 'ready':
    case 'office':
    case 'payment':
      return stageTray(config, c.stage) === tray;
    case 'flagged':
      return Boolean(c.troubleFlag) || isUnderInvestigation(c);
  }
}

/** Cases waiting for money: their stage feeds the payment tray (by default "ממתין לתשלום"). */
export function isPaymentStage(config: TrayConfig, stage: string) {
  return stage !== 'closed' && stageTray(config, stage) === 'payment';
}

/** Phases with their shown stages; `current` keeps a hidden stage visible. */
export function phasesOf(config: TrayConfig, current?: string) {
  return phaseGroups(config, current);
}

export function phaseOfCase(config: TrayConfig, stage: string): PhaseId {
  return phaseOfStage(config, stage);
}

/**
 * Stages to offer as board columns / filters: the shown ones in pipeline
 * order, plus any hidden stage that still holds cases.
 */
export function boardStages(config: TrayConfig, inUse: Iterable<string> = []): StageDef[] {
  const used = new Set(inUse);
  return stageDefs(config).filter((s) => !s.hidden || used.has(s.code));
}
