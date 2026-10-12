'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';

export type DocumentItem = {
  id: string;
  clientId: string;
  caseId?: string;
  fileName: string;
  originalName: string;
  label?: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  editedFromId?: string;
};

type Props = {
  clientId: string;
  documents: DocumentItem[];
  /** When set, uploads are attached to this case. */
  caseId?: string;
  /** Checklist items available for linking an upload (case page). */
  checklistOptions?: { code: string; label: string }[];
  /** Client contact — enables the "send to client" channels. */
  clientContact?: { email?: string; phone?: string };
  onChanged: () => void;
};

type StagedFile = { file: File; label: string };

const NEW_ITEM = '__new__';

function formatSize(bytes: number) {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fileEmoji(mimeType: string, name: string) {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return '📄';
  if (mimeType.includes('word') || /\.(docx?|rtf)$/i.test(name)) return '📝';
  if (mimeType.includes('sheet') || /\.(xlsx?|csv)$/i.test(name)) return '📊';
  return '📎';
}

/** Default display name: the file name without its extension. */
function defaultLabel(fileName: string) {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

export function isEditableDocument(doc: Pick<DocumentItem, 'mimeType' | 'originalName'>) {
  return (
    doc.mimeType.startsWith('image/') ||
    doc.mimeType === 'application/pdf' ||
    doc.originalName.toLowerCase().endsWith('.pdf')
  );
}

export function DocumentsPanel({ clientId, documents, caseId, checklistOptions, clientContact, onChanged }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragover, setDragover] = useState(false);
  const [error, setError] = useState('');
  const [checklistCode, setChecklistCode] = useState('');
  const [newItemName, setNewItemName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bundleOpen, setBundleOpen] = useState(false);
  const [bundleSent, setBundleSent] = useState(false);

  const canEmail = Boolean(clientContact?.email);
  const canPhone = Boolean(clientContact?.phone);
  const canSend = canEmail || canPhone;

  function toggleSelected(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  /** Send a set of documents as a single link. */
  async function sendDocuments(documentIds: string[], channel: 'email' | 'whatsapp', kind: 'single' | 'bundle') {
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/documents/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds, channel }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'שליחת המסמכים נכשלה');
        return;
      }
      if (kind === 'single') {
        setSendOpen(null);
        setSentNote(documentIds[0]);
        setTimeout(() => setSentNote((v) => (v === documentIds[0] ? null : v)), 3000);
      } else {
        setBundleOpen(false);
        setSelected([]);
        setBundleSent(true);
        setTimeout(() => setBundleSent(false), 3500);
      }
    } catch {
      setError('שגיאת תקשורת בשליחה');
    } finally {
      setSending(false);
    }
  }

  function sendDocument(docId: string, channel: 'email' | 'whatsapp') {
    return sendDocuments([docId], channel, 'single');
  }

  function stageFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setError('');
    setStaged((prev) => [...prev, ...list.map((file) => ({ file, label: defaultLabel(file.name) }))]);
    if (inputRef.current) inputRef.current.value = '';
  }

  function updateLabel(index: number, label: string) {
    setStaged((prev) => prev.map((item, i) => (i === index ? { ...item, label } : item)));
  }

  function removeStaged(index: number) {
    setStaged((prev) => prev.filter((_, i) => i !== index));
  }

  function clearStaged() {
    setStaged([]);
    setChecklistCode('');
    setNewItemName('');
    setError('');
  }

  async function uploadStaged() {
    if (!staged.length) return;
    setUploading(true);
    setError('');
    try {
      let code = checklistCode;

      // "Document not in the list": create a named checklist item first, then attach.
      if (code === NEW_ITEM) {
        if (!newItemName.trim()) {
          setError('נא לתת שם למסמך החדש ברשימה');
          return;
        }
        const res = await fetch(`/api/cases/${caseId}/checklist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: newItemName }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setError(data.error || 'יצירת המסמך ברשימה נכשלה');
          return;
        }
        code = data.data.code;
      }

      const form = new FormData();
      for (const item of staged) {
        form.append('file', item.file);
        form.append('label', item.label.trim() || defaultLabel(item.file.name));
      }
      if (caseId) form.append('caseId', caseId);
      if (code && code !== NEW_ITEM) form.append('checklistCode', code);

      const res = await fetch(`/api/clients/${clientId}/documents`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'ההעלאה נכשלה');
        return;
      }
      clearStaged();
      onChanged();
    } catch {
      setError('שגיאת תקשורת בהעלאה');
    } finally {
      setUploading(false);
    }
  }

  async function renameDocument(doc: DocumentItem) {
    const label = window.prompt('שם תצוגה למסמך:', doc.label || doc.originalName);
    if (label === null) return;
    setBusy(doc.id);
    try {
      await fetch(`/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function deleteDocument(doc: DocumentItem) {
    if (!window.confirm(`למחוק את המסמך "${doc.label || doc.originalName}"? הקובץ יימחק מהתיקייה.`)) return;
    setBusy(doc.id);
    try {
      await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' });
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div
        className={`upload-zone ${dragover ? 'dragover' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragover(true);
        }}
        onDragLeave={() => setDragover(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragover(false);
          stageFiles(e.dataTransfer.files);
        }}
      >
        <div className="upload-zone-icon">📁</div>
        <div>גרור לכאן קבצים או</div>
        <label className="upload-zone-label">
          בחר קבצים מהמחשב
          <input
            ref={inputRef}
            className="upload-file-input"
            type="file"
            multiple
            onChange={(e) => e.target.files && stageFiles(e.target.files)}
          />
        </label>
        <div className="upload-zone-hint">
          PDF, תמונות, וורד — כל סוג קובץ, כמה קבצים בבת אחת. אחרי הבחירה אפשר לתת שם לכל קובץ לפני השמירה.
        </div>
      </div>

      {staged.length > 0 && (
        <div className="card nested-card" style={{ marginTop: 12, padding: 16 }}>
          <div className="section-heading" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>קבצים להעלאה ({staged.length})</h3>
            <button type="button" className="doc-action-btn" onClick={clearStaged}>✕ בטל הכל</button>
          </div>

          {staged.map((item, index) => (
            <div key={`${item.file.name}-${index}`} className="doc-row" style={{ gap: 10 }}>
              <span style={{ fontSize: 18 }}>{fileEmoji(item.file.type, item.file.name)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <input
                  value={item.label}
                  onChange={(e) => updateLabel(index, e.target.value)}
                  placeholder="שם המסמך…"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
                />
                <span className="muted" style={{ fontSize: 11 }}>
                  {item.file.name} · {formatSize(item.file.size)}
                </span>
              </div>
              <button type="button" className="doc-action-btn reject" onClick={() => removeStaged(index)} title="הסר">✕</button>
            </div>
          ))}

          {caseId && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <select
                value={checklistCode}
                onChange={(e) => setChecklistCode(e.target.value)}
                style={{ flex: 1, minWidth: 200, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
              >
                <option value="">ללא שיוך לרשימת המסמכים</option>
                {(checklistOptions ?? []).map((item) => (
                  <option key={item.code} value={item.code}>שיוך אל: {item.label}</option>
                ))}
                <option value={NEW_ITEM}>➕ מסמך חדש שלא ברשימה…</option>
              </select>
              {checklistCode === NEW_ITEM && (
                <input
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder="שם המסמך החדש ברשימה…"
                  autoFocus
                  style={{ flex: 1, minWidth: 180, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--accent)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
                />
              )}
            </div>
          )}

          {error && <p className="form-error" style={{ marginTop: 10 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" className="button button-compact" disabled={uploading} onClick={() => void uploadStaged()}>
              {uploading ? 'מעלה…' : `⬆ העלה ${staged.length} ${staged.length === 1 ? 'קובץ' : 'קבצים'}`}
            </button>
            <label className="button button-secondary button-compact" style={{ cursor: 'pointer' }}>
              + הוסף עוד קבצים
              <input type="file" multiple style={{ display: 'none' }} onChange={(e) => e.target.files && stageFiles(e.target.files)} />
            </label>
          </div>
        </div>
      )}

      {error && staged.length === 0 && <p className="form-error" style={{ marginTop: 10 }}>{error}</p>}

      {documents.length === 0 ? (
        <p className="muted" style={{ marginTop: 16 }}>אין עדיין מסמכים בתיקייה.</p>
      ) : (
        <div style={{ marginTop: 16 }}>
          {canSend && documents.length > 1 && (
            <div className="split" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <label className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={selected.length === documents.length && documents.length > 0}
                  onChange={(e) => setSelected(e.target.checked ? documents.map((d) => d.id) : [])}
                />
                בחר הכל
              </label>
              {selected.length > 0 && (
                <button
                  type="button"
                  className={`doc-action-btn approve ${bundleOpen ? 'active-send' : ''}`}
                  onClick={() => setBundleOpen((v) => !v)}
                >
                  📤 שלח {selected.length} מסמכים בקישור אחד
                </button>
              )}
              {bundleSent && <span className="text-feedback-success" style={{ fontWeight: 600, fontSize: 13 }}>✓ נשלח קישור ללקוח</span>}
            </div>
          )}
          {bundleOpen && selected.length > 0 && (
            <div className="send-picker" style={{ marginBottom: 12 }}>
              <span className="muted" style={{ fontSize: 12 }}>שליחת קישור אחד ל-{selected.length} מסמכים דרך:</span>
              {canEmail && (
                <button type="button" className="doc-action-btn approve" disabled={sending} onClick={() => sendDocuments(selected, 'email', 'bundle')}>📧 אימייל</button>
              )}
              {canPhone && (
                <button type="button" className="doc-action-btn approve" disabled={sending} onClick={() => sendDocuments(selected, 'whatsapp', 'bundle')}>💬 וואטסאפ</button>
              )}
              <button type="button" className="doc-action-btn" onClick={() => setBundleOpen(false)}>ביטול</button>
              {sending && <span className="muted" style={{ fontSize: 12 }}>שולח…</span>}
              {error && <p className="form-error" style={{ width: '100%', margin: '4px 0 0' }}>{error}</p>}
            </div>
          )}
          {documents.map((doc) => (
            <div key={doc.id}>
              <div className="doc-row">
                {canSend && documents.length > 1 && (
                  <input
                    type="checkbox"
                    checked={selected.includes(doc.id)}
                    onChange={() => toggleSelected(doc.id)}
                    title="בחר לשליחה בקישור אחד"
                  />
                )}
                <span style={{ fontSize: 20 }}>{fileEmoji(doc.mimeType, doc.originalName)}</span>
                <div className="doc-name">
                  <a href={`/api/documents/${doc.id}`} target="_blank" rel="noreferrer" className="text-link">
                    {doc.label || doc.originalName}
                  </a>
                  <span className="muted" style={{ display: 'block', fontSize: 11 }}>
                    {formatSize(doc.size)} · {formatDate(doc.uploadedAt)}
                    {doc.editedFromId && ' · גרסה ערוכה'}
                    {sentNote === doc.id && <span className="text-feedback-success" style={{ fontWeight: 600 }}> · ✓ נשלח ללקוח</span>}
                  </span>
                </div>
                <div className="doc-actions">
                  {isEditableDocument(doc) && (
                    <Link className="doc-action-btn approve" href={`/documents/${doc.id}/edit` as never}>
                      ✏️ עריכה
                    </Link>
                  )}
                  {canSend && (
                    <button
                      type="button"
                      className={`doc-action-btn ${sendOpen === doc.id ? 'active-send' : ''}`}
                      onClick={() => setSendOpen((v) => (v === doc.id ? null : doc.id))}
                      title="שליחת המסמך ללקוח בקישור מאובטח"
                    >
                      📤 שלח ללקוח
                    </button>
                  )}
                  <a className="doc-action-btn" href={`/api/documents/${doc.id}?download=1`}>
                    ⬇ הורדה
                  </a>
                  <button type="button" className="doc-action-btn" disabled={busy === doc.id} onClick={() => renameDocument(doc)}>
                    שינוי שם
                  </button>
                  <button type="button" className="doc-action-btn reject" disabled={busy === doc.id} onClick={() => deleteDocument(doc)}>
                    מחיקה
                  </button>
                </div>
              </div>
              {sendOpen === doc.id && (
                <div className="send-picker">
                  <span className="muted" style={{ fontSize: 12 }}>שליחת קישור ל&quot;{doc.label || doc.originalName}&quot; דרך:</span>
                  {canEmail && (
                    <button type="button" className="doc-action-btn approve" disabled={sending} onClick={() => sendDocument(doc.id, 'email')}>
                      📧 אימייל
                    </button>
                  )}
                  {canPhone && (
                    <button type="button" className="doc-action-btn approve" disabled={sending} onClick={() => sendDocument(doc.id, 'whatsapp')}>
                      💬 וואטסאפ
                    </button>
                  )}
                  <button type="button" className="doc-action-btn" onClick={() => setSendOpen(null)}>ביטול</button>
                  {sending && <span className="muted" style={{ fontSize: 12 }}>שולח…</span>}
                  {error && <p className="form-error" style={{ width: '100%', margin: '4px 0 0' }}>{error}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
