'use client';

// Bring old clients in from Excel: paste the table (or upload a CSV), check the
// preview, import. Each row becomes a client with one case.
import { useMemo, useState } from 'react';
import { IconUpload } from '@/components/ui/icons';
import { useToast } from '@/components/ui/toast';

type ParsedRow = {
  fullName: string;
  phone: string;
  idNumber?: string;
  email?: string;
  city?: string;
  address?: string;
  notes?: string;
  caseTitle?: string;
  company?: string;
  caseKind?: string;
  stage?: string;
  fee?: number;
  paid?: number;
  trouble?: boolean;
};

/** Header aliases → field keys (Hebrew as it usually appears in the advisor's Excel). */
const HEADER_MAP: Array<{ keys: string[]; field: keyof ParsedRow }> = [
  { keys: ['שם', 'שם מלא', 'שם לקוח', 'לקוח', 'name', 'fullname'], field: 'fullName' },
  { keys: ['טלפון', 'נייד', 'פלאפון', 'phone'], field: 'phone' },
  { keys: ['ת.ז', 'ת"ז', 'תז', 'תעודת זהות', 'id'], field: 'idNumber' },
  { keys: ['אימייל', 'מייל', 'email'], field: 'email' },
  { keys: ['עיר', 'ישוב', 'city'], field: 'city' },
  { keys: ['כתובת', 'address'], field: 'address' },
  { keys: ['הערות', 'הערה', 'notes'], field: 'notes' },
  { keys: ['תיק', 'נושא', 'נושא התיק', 'case'], field: 'caseTitle' },
  { keys: ['חברה', 'חברה מטפלת', 'company'], field: 'company' },
  { keys: ['סוג', 'סוג תיק', 'חדש/חידוש', 'kind'], field: 'caseKind' },
  { keys: ['שלב', 'סטטוס', 'מצב', 'stage', 'status'], field: 'stage' },
  { keys: ['שכר טרחה', 'שכ"ט', 'מחיר', 'fee'], field: 'fee' },
  { keys: ['שולם', 'תשלום', 'paid'], field: 'paid' },
  { keys: ['בעיה', 'תקוע', 'דגל', 'trouble'], field: 'trouble' },
];

function matchHeader(header: string): keyof ParsedRow | null {
  const normalized = header.trim().toLowerCase().replace(/["'״׳]/g, '');
  for (const { keys, field } of HEADER_MAP) {
    if (keys.some((k) => normalized === k || normalized.includes(k))) return field;
  }
  return null;
}

/** Splits pasted text into rows; supports tab-separated (Excel paste) and CSV. */
function parseTable(text: string): ParsedRow[] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes('\t') ? '\t' : ',';

  function splitLine(line: string): string[] {
    if (delimiter === '\t') return line.split('\t');
    // Basic CSV with quoted-field support.
    const out: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) {
        out.push(current);
        current = '';
      } else current += ch;
    }
    out.push(current);
    return out;
  }

  const headers = splitLine(lines[0]).map(matchHeader);
  const rows: ParsedRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line);
    const row: Record<string, unknown> = {};
    headers.forEach((field, i) => {
      if (!field) return;
      const value = (cells[i] || '').trim();
      if (!value) return;
      if (field === 'fee' || field === 'paid') {
        const num = Number(value.replace(/[₪, ]/g, ''));
        if (Number.isFinite(num)) row[field] = num;
      } else if (field === 'trouble') {
        row[field] = ['כן', 'yes', 'true', '1', 'v', '✓'].includes(value.toLowerCase());
      } else {
        row[field] = value;
      }
    });
    if (row.fullName) rows.push(row as unknown as ParsedRow);
  }
  return rows;
}

export function ImportCard() {
  const toast = useToast();
  const [text, setText] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ clientsCreated: number; casesCreated: number; paymentsCreated: number; errors: string[] } | null>(null);
  const [error, setError] = useState('');

  const rows = useMemo(() => parseTable(text), [text]);

  async function readFile(files: FileList | null) {
    if (!files || !files.length) return;
    setText(await files[0].text());
  }

  async function runImport() {
    if (!rows.length) return;
    if (!window.confirm(`לייבא ${rows.length} לקוחות? לכל לקוח ייפתח תיק.`)) return;
    setImporting(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'הייבוא נכשל');
        return;
      }
      setResult(data.data);
      toast(`יובאו ${data.data.clientsCreated} לקוחות`);
      setText('');
    } catch {
      setError('אין חיבור לשרת — הייבוא לא בוצע');
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2 className="card-title">ייבוא לקוחות מאקסל</h2>
          <div className="card-sub">
            מסמנים באקסל את הטבלה כולל שורת הכותרות, מעתיקים ומדביקים כאן, או מעלים קובץ CSV.
          </div>
        </div>
        <label className="button button-secondary button-compact" style={{ cursor: 'pointer' }}>
          <IconUpload size={15} /> קובץ CSV
          <input type="file" hidden accept=".csv,.txt,.tsv" onChange={(e) => readFile(e.target.files)} />
        </label>
      </div>
      <p className="small ink-2" style={{ margin: '0 0 10px' }}>
        העמודות מזוהות לפי הכותרת: <strong>שם</strong> (חובה), טלפון, ת.ז, אימייל, עיר, כתובת, הערות, נושא התיק, חברה, סוג (חדש/חידוש), שלב, שכר טרחה, שולם, בעיה (כן/לא).
      </p>
      <textarea
        className="input paste-box"
        rows={7}
        placeholder={'שם\tטלפון\tת.ז\tחברה\tשלב\tשכר טרחה\tשולם\nישראל ישראלי\t050-0000000\t000000000\tמילגם\tהוגש\t2500\t1000'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="טבלה להדבקה"
      />

      {text.trim() && rows.length === 0 && (
        <p className="notice warn small" style={{ marginTop: 10 }}>
          לא נמצאה עמודת &quot;שם&quot; או שאין שורות מתחת לכותרות.
        </p>
      )}

      {rows.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="small strong" style={{ marginBottom: 6 }}>
            תצוגה מקדימה: {rows.length} לקוחות
          </div>
          <div className="table-wrap">
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>שם</th>
                  <th>טלפון</th>
                  <th>ת.ז</th>
                  <th>תיק</th>
                  <th>חברה</th>
                  <th>שלב</th>
                  <th>שכ&quot;ט</th>
                  <th>שולם</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 15).map((row, i) => (
                  <tr key={i}>
                    <td>{row.fullName}</td>
                    <td className="ltr">{row.phone || '—'}</td>
                    <td className="ltr">{row.idNumber || '—'}</td>
                    <td>{row.caseTitle || 'ברירת המחדל'}</td>
                    <td>{row.company || '—'}</td>
                    <td>{row.stage || 'איסוף מסמכים'}</td>
                    <td className="num">{row.fee ?? 0}</td>
                    <td className="num">{row.paid ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 15 && <p className="tiny muted">ועוד {rows.length - 15} שורות</p>}
          <button className="button" type="button" onClick={runImport} disabled={importing} style={{ marginTop: 12 }}>
            {importing ? 'מייבא…' : `ייבוא ${rows.length} לקוחות`}
          </button>
        </div>
      )}

      {error && (
        <p className="form-error" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}
      {result && (
        <p className="form-success" style={{ marginTop: 12 }}>
          יובאו {result.clientsCreated} לקוחות, {result.casesCreated} תיקים ו-{result.paymentsCreated} תשלומים.
          {result.errors.length > 0 && ` ${result.errors.length} שורות לא יובאו: ${result.errors.slice(0, 3).join('; ')}`}
        </p>
      )}
    </section>
  );
}
