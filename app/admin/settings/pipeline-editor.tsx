'use client';

// The case pipeline: four phases, each with its stages in order. Stages the
// system ships with can be renamed, moved and hidden; stages added here can
// also be deleted (their cases move to a stage chosen on deletion).
import { useRef, useState } from 'react';
import {
  isBuiltInStage,
  PHASE_IDS,
  type PhaseDef,
  type PhaseId,
  type StageDef,
  type StageTray,
  type TrayDef,
} from '@/lib/domain';
import { Modal } from '@/components/ui/overlay';
import { IconEye, IconEyeOff, IconLock, IconPlus, IconTrash } from '@/components/ui/icons';
import { CardShell, same, useSaver, type SaveFn } from './editors';
import { countLabel, moveWithin, randomCode, ReorderButtons } from './shared';

const STAGE_TRAYS: StageTray[] = ['ready', 'office', 'payment'];

/** Grouped by phase in phase order, 'closed' last — the order the server keeps. */
function ordered(stages: StageDef[]) {
  const closed = stages.filter((s) => s.code === 'closed');
  return [...PHASE_IDS.flatMap((p) => stages.filter((s) => s.phase === p && s.code !== 'closed')), ...closed];
}

export function PipelineEditor({
  stages,
  phases,
  trays,
  usage,
  save,
}: {
  stages: StageDef[];
  phases: PhaseDef[];
  trays: TrayDef[];
  usage: Record<string, number>;
  save: SaveFn;
}) {
  const [rows, setRows] = useState<StageDef[]>(() => ordered(stages));
  const [names, setNames] = useState<PhaseDef[]>(phases);
  const [moves, setMoves] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<StageDef | null>(null);
  const [target, setTarget] = useState('');
  const lastAdded = useRef<string | null>(null);
  const { saving, saved, run } = useSaver(save);

  const update = (code: string, patch: Partial<StageDef>) => setRows((prev) => prev.map((s) => (s.code === code ? { ...s, ...patch } : s)));
  const trayLabel = (id: StageTray) => trays.find((t) => t.id === id)?.label ?? id;
  const phaseLabel = (id: PhaseId) => names.find((p) => p.id === id)?.label || id;

  function add(phase: PhaseId) {
    const code = randomCode('st-');
    lastAdded.current = code;
    setRows((prev) => ordered([...prev, { code, label: '', phase }]));
  }

  function changePhase(code: string, phase: PhaseId) {
    // Lands at the end of its new phase.
    setRows((prev) => {
      const moved = prev.find((s) => s.code === code)!;
      return ordered([...prev.filter((s) => s.code !== code), { ...moved, phase }]);
    });
  }

  function remove(stage: StageDef, to?: string) {
    setRows((prev) => prev.filter((s) => s.code !== stage.code));
    if (to) {
      // Cases already headed to this stage follow on to the new target.
      setMoves((prev) => {
        const next: Record<string, string> = {};
        for (const [from, dest] of Object.entries(prev)) next[from] = dest === stage.code ? to : dest;
        next[stage.code] = to;
        return next;
      });
    }
  }

  function askRemove(stage: StageDef) {
    const cases = usage[stage.code] ?? 0;
    const pending = Object.entries(moves).filter(([, dest]) => dest === stage.code).length;
    if (!cases && !pending) {
      remove(stage);
      return;
    }
    setTarget(rows.find((s) => s.code !== stage.code && !s.hidden)?.code ?? 'closed');
    setDeleting(stage);
  }

  const shownBeforeClosed = rows.some((s) => s.code !== 'closed' && !s.hidden);
  const unnamed = rows.some((s) => !s.label.trim());
  const blocked = unnamed ? 'לכל שלב צריך שם' : !shownBeforeClosed ? 'צריך להשאיר לפחות שלב פעיל אחד לפני הסגירה' : undefined;
  const initialRows = ordered(stages);
  const dirty = !same(rows, initialRows) || !same(names, phases);
  const casesIn = (code: string) => (usage[code] ?? 0) + Object.entries(moves).filter(([, d]) => d === code).reduce((n, [from]) => n + (usage[from] ?? 0), 0);

  return (
    <>
      <CardShell
        title="שלבי התיק"
        sub="המסלול שכל תיק עובר, מחולק לארבעה חלקים. אפשר לשנות שמות, לסדר, להוסיף שלבים משלכם ולהסתיר שלבים שלא משתמשים בהם. שלב מוסתר מדולג: כפתור שהיה מעביר אליו מעביר לשלב הבא שמוצג."
        dirty={dirty}
        blocked={blocked}
        saving={saving}
        saved={saved}
        onSave={() =>
          run({
            stages: rows.map((s) => ({ ...s, label: s.label.trim(), hint: s.hint?.trim() || undefined })),
            phases: names.map((p) => ({ ...p, label: p.label.trim() || (phases.find((o) => o.id === p.id)?.label ?? p.label) })),
            ...(Object.keys(moves).length ? { stageMoves: moves } : {}),
          })
        }
      >
        <div className="pipeline">
          {names.map((phase, pi) => {
            const inPhase = rows.filter((s) => s.phase === phase.id);
            return (
              <section key={phase.id} className="pipeline-phase" aria-label={phase.label}>
                <div className="pipeline-phase-head">
                  <span className="pipeline-num" aria-hidden="true">
                    {pi + 1}
                  </span>
                  <input
                    className="input pipeline-phase-name"
                    value={phase.label}
                    onChange={(e) => setNames((prev) => prev.map((p) => (p.id === phase.id ? { ...p, label: e.target.value } : p)))}
                    aria-label={`שם החלק ${pi + 1} במסלול`}
                  />
                </div>

                <ol className="stage-list">
                  {inPhase.map((stage) => {
                    const index = rows.indexOf(stage);
                    const closed = stage.code === 'closed';
                    const builtIn = isBuiltInStage(stage.code);
                    const sameGroup = (s: StageDef) => s.phase === stage.phase && s.code !== 'closed';
                    const firstInPhase = inPhase[0] === stage;
                    const lastMovable = inPhase.filter((s) => s.code !== 'closed').at(-1) === stage;
                    const count = casesIn(stage.code);
                    return (
                      <li key={stage.code} className={`stage-edit ${stage.hidden ? 'is-hidden' : ''}`}>
                        <div className="stage-edit-main">
                          <input
                            className="input"
                            value={stage.label}
                            onChange={(e) => update(stage.code, { label: e.target.value })}
                            placeholder="שם השלב"
                            autoFocus={lastAdded.current === stage.code}
                            aria-label="שם השלב"
                          />
                          {count > 0 && <span className="chip stage-count">{countLabel(count, 'תיק אחד', 'תיקים')}</span>}
                          {stage.hidden && <span className="chip">מוסתר</span>}
                          <span className="stage-edit-tools">
                            {!closed && (
                              <ReorderButtons
                                label={stage.label || 'השלב'}
                                canUp={!firstInPhase}
                                canDown={!lastMovable}
                                onUp={() => setRows((prev) => moveWithin(prev, index, -1, sameGroup))}
                                onDown={() => setRows((prev) => moveWithin(prev, index, 1, sameGroup))}
                              />
                            )}
                            {closed ? (
                              <span className="icon-button small locked" title="שלב הסגירה תמיד אחרון ותמיד מוצג" aria-label="שלב הסגירה תמיד אחרון ותמיד מוצג">
                                <IconLock size={14} />
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="icon-button small"
                                onClick={() => update(stage.code, { hidden: !stage.hidden })}
                                aria-pressed={Boolean(stage.hidden)}
                                aria-label={stage.hidden ? `הצגת ${stage.label}` : `הסתרת ${stage.label}`}
                                title={stage.hidden ? 'השלב מוסתר — לחיצה מחזירה אותו' : 'הסתרת השלב'}
                              >
                                {stage.hidden ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                              </button>
                            )}
                            {builtIn ? (
                              !closed && (
                                <span className="icon-button small locked" title="שלב מובנה: המערכת נשענת עליו, אז אפשר להסתיר אותו אבל לא למחוק" aria-label="שלב מובנה — אפשר להסתיר, לא למחוק">
                                  <IconLock size={14} />
                                </span>
                              )
                            ) : (
                              <button type="button" className="icon-button small" onClick={() => askRemove(stage)} aria-label={`מחיקת ${stage.label || 'השלב'}`} title="מחיקת השלב">
                                <IconTrash size={15} />
                              </button>
                            )}
                          </span>
                        </div>
                        <div className="stage-edit-more">
                          <input
                            className="input"
                            value={stage.hint ?? ''}
                            onChange={(e) => update(stage.code, { hint: e.target.value })}
                            placeholder="מה עושים בשלב הזה (מוצג בתיק תחת &quot;השלב הבא&quot;)"
                            aria-label={`מה עושים בשלב ${stage.label}`}
                          />
                          <select
                            className="select"
                            value={stage.tray ?? ''}
                            onChange={(e) => update(stage.code, { tray: (e.target.value || undefined) as StageTray | undefined })}
                            aria-label={`באיזה מגש במסך היום מופיעים תיקים בשלב ${stage.label}`}
                          >
                            <option value="">לא במגש במסך היום</option>
                            {STAGE_TRAYS.map((t) => (
                              <option key={t} value={t}>
                                מגש: {trayLabel(t)}
                              </option>
                            ))}
                          </select>
                          {!closed && (
                            <select
                              className="select"
                              value={stage.phase}
                              onChange={(e) => changePhase(stage.code, e.target.value as PhaseId)}
                              aria-label={`באיזה חלק במסלול נמצא השלב ${stage.label}`}
                            >
                              {names.map((p) => (
                                <option key={p.id} value={p.id}>
                                  חלק: {p.label || phaseLabel(p.id)}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>

                <button type="button" className="button button-quiet button-compact pipeline-add" onClick={() => add(phase.id)}>
                  <IconPlus size={15} /> שלב חדש ב{phase.label || 'חלק הזה'}
                </button>
              </section>
            );
          })}
        </div>
        {Object.keys(moves).length > 0 && (
          <p className="tiny muted" style={{ marginTop: 12 }}>
            בשמירה יועברו {Object.keys(moves).reduce((n, code) => n + (usage[code] ?? 0), 0)} תיקים מהשלבים שנמחקו.
          </p>
        )}
      </CardShell>

      {deleting && (
        <Modal
          title={`מחיקת השלב "${deleting.label || 'ללא שם'}"`}
          size="narrow"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button
                type="button"
                className="button"
                onClick={() => {
                  remove(deleting, target);
                  setDeleting(null);
                }}
              >
                מחיקה והעברת התיקים
              </button>
              <button type="button" className="button button-quiet" onClick={() => setDeleting(null)}>
                ביטול
              </button>
            </>
          }
        >
          <p className="ask-text">
            {countLabel(casesIn(deleting.code), 'תיק אחד נמצא', 'תיקים נמצאים')} עכשיו בשלב הזה. לאיזה שלב להעביר {casesIn(deleting.code) === 1 ? 'אותו' : 'אותם'}?
          </p>
          <label className="field">
            <span className="field-label">השלב החדש</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {rows
                .filter((s) => s.code !== deleting.code)
                .map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label || 'ללא שם'}
                    {s.hidden ? ' (מוסתר)' : ''}
                  </option>
                ))}
            </select>
          </label>
          <p className="tiny muted">ההעברה קורית רק כשלוחצים &quot;שמירה&quot;. עד אז אפשר לרענן את הדף ולבטל.</p>
        </Modal>
      )}
    </>
  );
}
