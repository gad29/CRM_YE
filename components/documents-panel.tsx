'use client';

// The files in a client's folder (or in one case): drop to upload, name each
// file before saving, then preview, edit, rename, send or download — one by
// one or as a selection (one link, or one ZIP).
import Link from 'next/link';
import { useRef, useState } from 'react';
import './documents-panel.css';
import { Field, formatDate } from '@/components/ui/bits';
import { Menu, Modal } from '@/components/ui/overlay';
import { useToast } from '@/components/ui/toast';
import {
  IconDownload,
  IconFile,
  IconImage,
  IconMail,
  IconMore,
  IconPencil,
  IconSend,
  IconTrash,
  IconUpload,
  IconWhatsapp,
  IconX,
  IconZip,
} from '@/components/ui/icons';

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
  /** Document id → the checklist item it belongs to, shown under the file name. */
  linkedLabels?: Record<string, string>;
  /** Text for the empty folder. */
  emptyText?: string;
};

type StagedFile = { file: File; label: string };

const NEW_ITEM = '__new__';

function formatSize(bytes: number) {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Default display name: the file name without its extension. */
function defaultLabel(fileName: string) {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function fileKind(mimeType: string, name: string) {
  if (mimeType.startsWith('image/')) return 'תמונה';
  if (mimeType === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return 'PDF';
  if (mimeType.includes('word') || /\.(docx?|rtf)$/i.test(name)) return 'Word';
  if (mimeType.includes('sheet') || /\.(xlsx?|csv)$/i.test(name)) return 'Excel';
  return 'קובץ';
}

export function DocIcon({ mimeType }: { mimeType: string }) {
  return <span className="doc-icon">{mimeType.startsWith('image/') ? <IconImage size={17} /> : <IconFile size={17} />}</span>;
}

export function isEditableDocument(doc: Pick<DocumentItem, 'mimeType' | 'originalName'>) {
  return (
    doc.mimeType.startsWith('image/') ||
    doc.mimeType === 'application/pdf' ||
    doc.originalName.toLowerCase().endsWith('.pdf')
  );
}

export function DocumentsPanel({
  clientId,
  documents,
  caseId,
  checklistOptions,
  clientContact,
  onChanged,
  linkedLabels,
  emptyText,
}: Props) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const [checklistCode, setChecklistCode] = useState('');
  const [newItemName, setNewItemName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [renaming, setRenaming] = useState<{ doc: DocumentItem; value: string } | null>(null);
  const [deleting, setDeleting] = useState<DocumentItem | null>(null);
  const [busy, setBusy] = useState(false);

  const canEmail = Boolean(clientContact?.email);
  const canPhone = Boolean(clientContact?.phone);
  const zipBase = `/api/clients/${clientId}/documents/zip`;
  const zipAllHref = caseId ? `${zipBase}?caseId=${encodeURIComponent(caseId)}` : zipBase;
  const zipSelectedHref = `${zipBase}?ids=${selected.map(encodeURIComponent).join(',')}`;
  const allSelected = documents.length > 0 && selected.length === documents.length;

  function toggleSelected(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  /** Send a set of documents to the client as one secure link. */
  async function sendDocuments(documentIds: string[], channel: 'email' | 'whatsapp') {
    setSending(true);
    try {
      const res = await fetch('/api/documents/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds, channel }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast(data.error || 'שליחת המסמכים נכשלה', 'error');
        return;
      }
      const where = channel === 'email' ? 'במייל' : 'בוואטסאפ';
      toast(documentIds.length === 1 ? `הקישור נשלח ללקוח ${where}` : `קישור ל-${documentIds.length} מסמכים נשלח ללקוח ${where}`);
      if (documentIds.length > 1) setSelected([]);
    } catch {
      toast('אין חיבור לשרת — השליחה לא בוצעה', 'error');
    } finally {
      setSending(false);
    }
  }

  function stageFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setError('');
    setStaged((prev) => [...prev, ...list.map((file) => ({ file, label: defaultLabel(file.name) }))]);
    if (inputRef.current) inputRef.current.value = '';
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
          setError('תנו שם למסמך החדש ברשימה');
          return;
        }
        const res = await fetch(`/api/cases/${caseId}/checklist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: newItemName }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setError(data.error || 'הוספת המסמך לרשימה נכשלה');
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || 'ההעלאה נכשלה');
        return;
      }
      toast(staged.length === 1 ? 'הקובץ נשמר בתיקייה' : `${staged.length} קבצים נשמרו בתיקייה`);
      clearStaged();
      onChanged();
    } catch {
      setError('אין חיבור לשרת — הקבצים לא הועלו');
    } finally {
      setUploading(false);
    }
  }

  async function saveRename() {
    if (!renaming) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/documents/${renaming.doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: renaming.value }),
      });
      if (!res.ok) {
        toast('שינוי השם נכשל', 'error');
        return;
      }
      setRenaming(null);
      toast('השם עודכן');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/documents/${deleting.id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast('מחיקת הקובץ נכשלה', 'error');
        return;
      }
      setSelected((prev) => prev.filter((id) => id !== deleting.id));
      setDeleting(null);
      toast('הקובץ נמחק');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const nameOf = (doc: DocumentItem) => doc.label || doc.originalName;

  return (
    <div className="docs-panel">
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          stageFiles(e.dataTransfer.files);
        }}
      >
        <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
          <IconUpload size={18} />
          <span>
            גררו קבצים לכאן, או{' '}
            <button type="button" className="text-link" style={{ background: 'none', border: 0, padding: 0 }} onClick={() => inputRef.current?.click()}>
              בחרו מהמחשב
            </button>
          </span>
        </div>
        <div className="tiny" style={{ marginTop: 4 }}>PDF, תמונות, Word — כמה קבצים יחד. לפני השמירה אפשר לתת שם לכל קובץ.</div>
        <input ref={inputRef} type="file" multiple hidden onChange={(e) => e.target.files && stageFiles(e.target.files)} />
      </div>

      {staged.length > 0 && (
        <div className="staged">
          <div className="row between">
            <span className="strong small">
              {staged.length === 1 ? 'קובץ אחד מוכן להעלאה' : `${staged.length} קבצים מוכנים להעלאה`}
            </span>
            <button type="button" className="button button-quiet button-compact" onClick={clearStaged}>
              ביטול
            </button>
          </div>
          {staged.map((item, index) => (
            <div key={`${item.file.name}-${index}`} className="doc-row">
              <DocIcon mimeType={item.file.type} />
              <div className="doc-name">
                <input
                  className="input"
                  value={item.label}
                  onChange={(e) => setStaged((prev) => prev.map((s, i) => (i === index ? { ...s, label: e.target.value } : s)))}
                  placeholder="שם המסמך"
                  aria-label="שם המסמך"
                  style={{ height: 34 }}
                />
                <div className="tiny muted" style={{ marginTop: 3 }}>
                  {item.file.name} · {formatSize(item.file.size)}
                </div>
              </div>
              <button
                type="button"
                className="icon-button small"
                onClick={() => setStaged((prev) => prev.filter((_, i) => i !== index))}
                aria-label="הסרה מהרשימה"
              >
                <IconX size={15} />
              </button>
            </div>
          ))}

          {caseId && (
            <div className="row" style={{ alignItems: 'stretch' }}>
              <select className="select" style={{ flex: 1, minWidth: 200 }} value={checklistCode} onChange={(e) => setChecklistCode(e.target.value)} aria-label="שיוך לרשימת המסמכים">
                <option value="">בלי שיוך לרשימת המסמכים</option>
                {(checklistOptions ?? []).map((item) => (
                  <option key={item.code} value={item.code}>
                    שיוך אל: {item.label}
                  </option>
                ))}
                <option value={NEW_ITEM}>מסמך חדש שלא ברשימה…</option>
              </select>
              {checklistCode === NEW_ITEM && (
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 180 }}
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder="שם המסמך החדש ברשימה"
                  autoFocus
                />
              )}
            </div>
          )}

          {error && <p className="form-error">{error}</p>}

          <div className="row">
            <button type="button" className="button" disabled={uploading} onClick={() => void uploadStaged()}>
              <IconUpload size={16} />
              {uploading ? 'מעלה…' : staged.length === 1 ? 'העלאת הקובץ' : `העלאת ${staged.length} הקבצים`}
            </button>
            <button type="button" className="button button-secondary" onClick={() => inputRef.current?.click()}>
              הוספת קבצים
            </button>
          </div>
        </div>
      )}

      {documents.length === 0 ? (
        <p className="muted small" style={{ margin: '14px 2px 0' }}>{emptyText ?? 'אין עדיין קבצים בתיקייה.'}</p>
      ) : (
        <div style={{ marginTop: 14 }}>
          {selected.length > 0 ? (
            <div className="selection-bar">
              <span className="strong small">{selected.length === 1 ? 'קובץ אחד נבחר' : `${selected.length} קבצים נבחרו`}</span>
              <span className="spacer" />
              <a className="button button-secondary button-compact" href={zipSelectedHref} download>
                <IconZip size={15} />
                הורדה כ-ZIP
              </a>
              {canEmail && (
                <button type="button" className="button button-secondary button-compact" disabled={sending} onClick={() => sendDocuments(selected, 'email')}>
                  <IconMail size={15} />
                  שליחה במייל
                </button>
              )}
              {canPhone && (
                <button type="button" className="button button-secondary button-compact" disabled={sending} onClick={() => sendDocuments(selected, 'whatsapp')}>
                  <IconWhatsapp size={15} />
                  שליחה בוואטסאפ
                </button>
              )}
              <button type="button" className="button button-quiet button-compact" onClick={() => setSelected([])}>
                ביטול הבחירה
              </button>
            </div>
          ) : (
            <div className="row between" style={{ padding: '0 6px 6px' }}>
              <label className="checkbox small muted">
                <input type="checkbox" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? documents.map((d) => d.id) : [])} />
                בחירת הכל
              </label>
              <a className="button button-quiet button-compact" href={zipAllHref} download title="כל הקבצים בקובץ ZIP אחד">
                <IconZip size={15} />
                הורדת הכל (ZIP)
              </a>
            </div>
          )}

          <div>
            {documents.map((doc) => (
              <div key={doc.id} className={`doc-row ${selected.includes(doc.id) ? 'picked' : ''}`}>
                <input
                  type="checkbox"
                  className="doc-check"
                  checked={selected.includes(doc.id)}
                  onChange={() => toggleSelected(doc.id)}
                  aria-label={`בחירת ${nameOf(doc)}`}
                />
                <DocIcon mimeType={doc.mimeType} />
                <div className="doc-name">
                  <a href={`/api/documents/${doc.id}`} target="_blank" rel="noreferrer" className="doc-title truncate" title={nameOf(doc)}>
                    {nameOf(doc)}
                  </a>
                  <div className="tiny muted">
                    {fileKind(doc.mimeType, doc.originalName)} · {formatSize(doc.size)} · {formatDate(doc.uploadedAt)}
                    {doc.editedFromId && ' · גרסה ערוכה'}
                    {linkedLabels?.[doc.id] && <> · {linkedLabels[doc.id]}</>}
                  </div>
                </div>
                <div className="doc-actions">
                  {isEditableDocument(doc) && (
                    <Link className="icon-button small" href={`/documents/${doc.id}/edit` as never} title="עריכה (סימון, טקסט, חתימה)" aria-label="עריכה">
                      <IconPencil size={15} />
                    </Link>
                  )}
                  <a className="icon-button small" href={`/api/documents/${doc.id}?download=1`} title="הורדה" aria-label="הורדה">
                    <IconDownload size={15} />
                  </a>
                  <Menu trigger={<IconMore size={16} />} label={`פעולות על ${nameOf(doc)}`}>
                    {canEmail && (
                      <button type="button" className="menu-item" disabled={sending} onClick={() => sendDocuments([doc.id], 'email')}>
                        <IconMail size={16} />
                        שליחה ללקוח במייל
                      </button>
                    )}
                    {canPhone && (
                      <button type="button" className="menu-item" disabled={sending} onClick={() => sendDocuments([doc.id], 'whatsapp')}>
                        <IconWhatsapp size={16} />
                        שליחה ללקוח בוואטסאפ
                      </button>
                    )}
                    {!canEmail && !canPhone && (
                      <span className="menu-item muted" style={{ cursor: 'default' }}>
                        <IconSend size={16} />
                        אין ללקוח טלפון או מייל
                      </span>
                    )}
                    <button type="button" className="menu-item" onClick={() => setRenaming({ doc, value: nameOf(doc) })}>
                      <IconPencil size={16} />
                      שינוי שם
                    </button>
                    <div className="menu-sep" />
                    <button type="button" className="menu-item danger" onClick={() => setDeleting(doc)}>
                      <IconTrash size={16} />
                      מחיקת הקובץ
                    </button>
                  </Menu>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {renaming && (
        <Modal
          title="שינוי שם הקובץ"
          size="narrow"
          onClose={() => setRenaming(null)}
          footer={
            <>
              <button type="button" className="button button-secondary" onClick={() => setRenaming(null)}>
                ביטול
              </button>
              <button type="button" className="button" disabled={busy} onClick={() => void saveRename()}>
                שמירת השם
              </button>
            </>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveRename();
            }}
          >
            <Field label="השם שיופיע בתיקייה">
              <input value={renaming.value} onChange={(e) => setRenaming({ ...renaming, value: e.target.value })} />
            </Field>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal
          title="מחיקת הקובץ"
          size="narrow"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button type="button" className="button button-secondary" onClick={() => setDeleting(null)}>
                ביטול
              </button>
              <button type="button" className="button button-danger" disabled={busy} onClick={() => void confirmDelete()}>
                <IconTrash size={16} />
                מחיקה
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            הקובץ <strong>{nameOf(deleting)}</strong> יימחק מהתיקייה, ואי אפשר לשחזר אותו.
          </p>
        </Modal>
      )}
    </div>
  );
}
