'use client';

// The "ממשק" tab: which areas are on, the Today trays, and the wording of
// menus, buttons and titles.
import { useMemo, useState } from 'react';
import type { ModuleSwitches, TrayDef } from '@/lib/domain';
import { TEXT_GROUPS } from '@/lib/texts';
import { IconEye, IconEyeOff, IconSearch } from '@/components/ui/icons';
import { CardShell, same, useSaver, type SaveFn } from './editors';

const MODULES: { id: keyof ModuleSwitches; label: string; off: string }[] = [
  { id: 'tasks', label: 'משימות ותזכורות', off: 'כבוי: נעלמים המשימות מהתפריט, כפתורי "תזכורת" בתיקים ובלקוחות וההתראות בראש המסך.' },
  { id: 'chat', label: 'צ׳אט צוות', off: 'כבוי: הצ׳אט יורד מהתפריט. ההודעות שכבר נשלחו נשמרות.' },
  { id: 'payments', label: 'תשלומים וגבייה', off: 'כבוי: דף התשלומים, לשונית התשלומים בתיק ובלקוח וסימוני "שולם" נעלמים. שכר הטרחה נשאר שמור.' },
];

export function ModulesEditor({ modules, save }: { modules: ModuleSwitches; save: SaveFn }) {
  const [draft, setDraft] = useState(modules);
  const { saving, saved, run } = useSaver(save);
  return (
    <CardShell
      title="אזורים במערכת"
      sub="אזור שלא משתמשים בו אפשר לכבות, והוא יורד מהתפריט ומהמסכים לכל הצוות. שום מידע לא נמחק — מדליקים שוב והכול חוזר."
      dirty={!same(draft, modules)}
      saving={saving}
      saved={saved}
      onSave={() => run({ modules: draft })}
    >
      <div className="module-list">
        {MODULES.map((m) => (
          <label key={m.id} className="module-row">
            <input type="checkbox" checked={draft[m.id]} onChange={(e) => setDraft((d) => ({ ...d, [m.id]: e.target.checked }))} />
            <span>
              <span className="strong">{m.label}</span>
              <span className="tiny muted module-off">{m.off}</span>
            </span>
          </label>
        ))}
      </div>
    </CardShell>
  );
}

export function TraysEditor({ trays, save }: { trays: TrayDef[]; save: SaveFn }) {
  const [rows, setRows] = useState(trays);
  const { saving, saved, run } = useSaver(save);
  const update = (id: string, patch: Partial<TrayDef>) => setRows((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const blocked = rows.some((t) => !t.label.trim()) ? 'לכל מגש צריך שם' : undefined;
  return (
    <CardShell
      title="המגשים במסך היום"
      sub='המגשים בראש מסך "היום" ובסינון התיקים. "מסמכים חסרים" ו"מסומנים" מתמלאים לפי מה שחסר בתיק; לאילו מגשים נכנסים תיקים בכל שלב קובעים בלשונית שלבים.'
      dirty={!same(rows, trays)}
      blocked={blocked}
      saving={saving}
      saved={saved}
      onSave={() => run({ trays: rows.map((t) => ({ ...t, label: t.label.trim(), hint: t.hint.trim() })) })}
    >
      <div className="edit-list">
        {rows.map((t) => (
          <div key={t.id} className={`edit-row tray-edit ${t.hidden ? 'is-hidden' : ''}`}>
            <input className="input" value={t.label} onChange={(e) => update(t.id, { label: e.target.value })} aria-label="שם המגש" placeholder="שם המגש" />
            <input className="input" value={t.hint} onChange={(e) => update(t.id, { hint: e.target.value })} aria-label={`שורת ההסבר של ${t.label}`} placeholder="שורת הסבר קצרה" />
            <button
              type="button"
              className="icon-button small"
              onClick={() => update(t.id, { hidden: !t.hidden || undefined })}
              aria-pressed={Boolean(t.hidden)}
              aria-label={t.hidden ? `הצגת ${t.label}` : `הסתרת ${t.label}`}
              title={t.hidden ? 'המגש מוסתר — לחיצה מחזירה אותו' : 'הסתרת המגש'}
            >
              {t.hidden ? <IconEyeOff size={15} /> : <IconEye size={15} />}
            </button>
          </div>
        ))}
      </div>
    </CardShell>
  );
}

const placeholders = (text: string) => text.match(/\{\w+\}/g) ?? [];

export function TextsEditor({ texts, save }: { texts: Record<string, string>; save: SaveFn }) {
  const [draft, setDraft] = useState<Record<string, string>>(texts);
  const [query, setQuery] = useState('');
  const { saving, saved, run } = useSaver(save);

  // Only real overrides: non-empty and different from the default.
  const overrides = useMemo(() => {
    const out: Record<string, string> = {};
    for (const g of TEXT_GROUPS) {
      for (const item of g.items) {
        const value = draft[item.key]?.trim();
        if (value && value !== item.value) out[item.key] = value;
      }
    }
    return out;
  }, [draft]);

  const q = query.trim();
  const groups = TEXT_GROUPS.map((g) => ({
    ...g,
    items: q ? g.items.filter((i) => [i.value, i.note ?? '', draft[i.key] ?? ''].some((s) => s.includes(q))) : g.items,
  })).filter((g) => g.items.length);

  const changed = Object.keys(overrides).length;

  return (
    <CardShell
      title="ניסוחים"
      sub="השמות של התפריט, הכפתורים והכותרות. משאירים ריק כדי להשתמש בניסוח הרגיל (הוא מופיע באפור בתוך התיבה)."
      dirty={!same(overrides, texts)}
      saving={saving}
      saved={saved}
      onSave={() => run({ texts: overrides })}
      extra={changed ? <span className="tiny muted">{changed === 1 ? 'ניסוח אחד שונה' : `${changed} ניסוחים שונו`}</span> : undefined}
    >
      <label className="texts-search">
        <IconSearch size={15} />
        <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש ניסוח, למשל: תיק חדש" aria-label="חיפוש ניסוח" />
      </label>

      {groups.length === 0 && <p className="muted small">אין ניסוח שמתאים לחיפוש.</p>}

      {groups.map((g) => (
        <section key={g.id} className="texts-group" aria-label={g.label}>
          <h3 className="texts-group-title">{g.label}</h3>
          <div className="texts-list">
            {g.items.map((item) => {
              const value = draft[item.key] ?? '';
              const missing = value.trim() ? placeholders(item.value).filter((p) => !value.includes(p)) : [];
              const own = Boolean(value.trim()) && value.trim() !== item.value;
              return (
                <div key={item.key} className={`text-row ${own ? 'is-own' : ''}`}>
                  <div className="text-row-about">
                    <span className="text-row-default">{item.value}</span>
                    {item.note && <span className="tiny muted">{item.note}</span>}
                  </div>
                  <div className="text-row-edit">
                    <input
                      className="input"
                      value={value}
                      onChange={(e) => setDraft((d) => ({ ...d, [item.key]: e.target.value }))}
                      placeholder={item.value}
                      aria-label={`ניסוח במקום "${item.value}"`}
                    />
                    {own && (
                      <button type="button" className="button button-quiet button-compact" onClick={() => setDraft((d) => ({ ...d, [item.key]: '' }))}>
                        חזרה לרגיל
                      </button>
                    )}
                  </div>
                  {missing.length > 0 && (
                    <p className="tiny settings-blocked text-row-warn">
                      חסר {missing.join(', ')} — במקום הזה המערכת משלבת את {missing.includes('{stage}') ? 'שם השלב' : 'הערך המתאים'}, ובלעדיו הוא לא יופיע.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </CardShell>
  );
}
