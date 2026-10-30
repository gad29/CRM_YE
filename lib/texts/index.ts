// On-screen wording that the admin can rename in Settings → "ניסוחים".
// Each area keeps its own list (shell, cases, clients); a screen reads a text
// with useText()(key) and gets the saved wording, or the default below.
import type { AppConfig } from '@/lib/domain';
import { CASE_TEXTS } from './cases';
import { CLIENT_TEXTS } from './clients';
import { SHELL_TEXTS } from './shell';

export interface TextDef {
  key: string;
  /** The default wording. {name}-style placeholders are filled in by the screen. */
  value: string;
  /** Where it appears, when the wording alone doesn't say. */
  note?: string;
}

export interface TextGroup {
  id: string;
  label: string;
  items: TextDef[];
}

export const TEXT_GROUPS: TextGroup[] = [
  { id: 'shell', label: 'תפריט ומסכים', items: SHELL_TEXTS },
  { id: 'clients', label: 'לקוחות', items: CLIENT_TEXTS },
  { id: 'cases', label: 'תיקים והשלב הבא', items: CASE_TEXTS },
];

export const TEXT_DEFAULTS: Record<string, string> = Object.fromEntries(
  TEXT_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.value])),
);

/** The wording for `key`: the saved one, else the default; {placeholders} filled from `vars`. */
export function textOf(config: Pick<AppConfig, 'texts'> | undefined, key: string, vars?: Record<string, string | number>) {
  const raw = config?.texts?.[key]?.trim() || TEXT_DEFAULTS[key] || key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}
