'use client';

// Small pieces shared by the settings editors.
import { IconChevronDown } from '@/components/ui/icons';

const CODE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** prefix + 6 random [a-z0-9] — the shape the server accepts for added stages / fields. */
export function randomCode(prefix: 'st-' | 'f-') {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return prefix + Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

/** Swap item `index` with its neighbour in `dir`, among the items `inGroup` accepts. */
export function moveWithin<T>(list: T[], index: number, dir: -1 | 1, inGroup: (item: T) => boolean = () => true) {
  let j = index + dir;
  while (j >= 0 && j < list.length && !inGroup(list[j])) j += dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

export function ReorderButtons({
  label,
  canUp,
  canDown,
  onUp,
  onDown,
}: {
  label: string;
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <span className="reorder">
      <button type="button" className="icon-button small flip" disabled={!canUp} onClick={onUp} aria-label={`הזזת ${label} למעלה`}>
        <IconChevronDown size={15} />
      </button>
      <button type="button" className="icon-button small" disabled={!canDown} onClick={onDown} aria-label={`הזזת ${label} למטה`}>
        <IconChevronDown size={15} />
      </button>
    </span>
  );
}

/** "3 תיקים" / "תיק אחד" / "" */
export function countLabel(n: number | undefined, one: string, many: string) {
  if (!n) return '';
  return n === 1 ? one : `${n} ${many}`;
}
