'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { DocumentsPanel, type DocumentItem } from '@/components/documents-panel';
import {
  BLANK_CONTRACT_CODE,
  CASE_KIND_LABELS,
  CASE_STAGES,
  CHECKLIST_STATUS_LABELS,
  DECISION_LABELS,
  INVESTIGATION_OUTCOME_LABELS,
  optionLabel,
  PAYMENT_STATUS_LABELS,
  stageLabelOf,
  isUnderInvestigation,
  type CaseKind,
  type CaseStage,
  type ChecklistStatus,
  type DecisionStatus,
  type InvestigationOutcome,
  type OperatingCompany,
  type PaymentMethod,
} from '@/lib/domain';
import { useConfig } from '@/components/config-provider';
import { CompanyChip } from '@/components/company-chip';

type CaseDetail = {
  case: {
    id: string;
    clientId: string;
    title: string;
    officeName: string;
    stage: CaseStage;
    checklist: Array<{ code: string; label: string; status: ChecklistStatus; note?: string; documentIds: string[] }>;
    fee: number;
    referenceNumber?: string;
    nextAction?: string;
    notes?: string;
    description?: string;
    decision?: string;
    decisionStatus?: DecisionStatus;
    investigationOutcome?: InvestigationOutcome;
    company?: OperatingCompany;
    caseKind?: CaseKind;
    troubleFlag?: boolean;
    troubleNote?: string;
    openedBy?: string;
    assignedTo?: string;
    openedByName?: string;
    assignedToName?: string;
    /** Who handles the case now: a worker id, 'admin' or ADM-x. */
    handlerId: string;
    handlerName?: string;
    paymentStatusOverride?: 'paid' | 'partial' | 'unpaid';
    openedAt: string;
    submittedAt?: string;
    closedAt?: string;
    missingItems: number;
    finance: { fee: number; paid: number; balance: number; status: 'paid' | 'partial' | 'unpaid'; overridden?: boolean };
  };
  client: { id: string; fullName: string; phone: string; email?: string } | null;
  documents: DocumentItem[];
  payments: Array<{ id: string; amount: number; method: PaymentMethod; paidAt: string; note?: string }>;
  activity: Array<{ id: string; summary: string; at: string }>;
  workers: Array<{ id: string; name: string }>;
  managers: Array<{ id: string; name: string }>;
  canManagePayments?: boolean;
  canAssign?: boolean;
  canTransferToManager?: boolean;
  hasBlankContract?: boolean;
};

function shekel(amount: number) {
  return `₪${amount.toLocaleString('he-IL')}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
}

const CHECKLIST_ACTIONS: Array<{ status: ChecklistStatus; label: string; className?: string }> = [
  { status: 'received', label: '✓ התקבל', className: 'approve' },
  { status: 'approved', label: '✓✓ אושר', className: 'approve' },
  { status: 'resubmit-needed', label: '↩ נדרש מחדש', className: 'resubmit' },
  { status: 'not-applicable', label: '— לא רלוונטי' },
  { status: 'missing', label: 'סמן כחסר' },
];

export default function CaseDetailPage({ params }: { params: Promise<{ caseId: string }> }) {
  const router = useRouter();
  const config = useConfig();
  const { caseId } = use(params);
  const [data, setData] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingStage, setSavingStage] = useState(false);
  const [newItemLabel, setNewItemLabel] = useState('');
  const [newItemCode, setNewItemCode] = useState('');
  const [detailsForm, setDetailsForm] = useState<Record<string, string>>({});
  const [editingDetails, setEditingDetails] = useState(false);
  const [payForm, setPayForm] = useState({ amount: '', method: 'bank-transfer', note: '' });
  const [payError, setPayError] = useState('');
  const [editingFee, setEditingFee] = useState(false);
  const [feeValue, setFeeValue] = useState('');
  const [editingPayId, setEditingPayId] = useState<string | null>(null);
  const [payEdit, setPayEdit] = useState({ amount: '', method: '' });
  const [uploadingCode, setUploadingCode] = useState<string | null>(null);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const checklistUploadRef = useRef<HTMLInputElement>(null);
  const uploadCodeRef = useRef<string | null>(null);

  const reload = useCallback(() => {
    fetch(`/api/cases/${caseId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setData(d.data);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [caseId]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading) return <div className="card muted" style={{ padding: 24 }}>טוען תיק…</div>;
  if (!data) return <div className="card muted" style={{ padding: 24 }}>התיק לא נמצא.</div>;

  const caseRecord = data.case;
  const stageIndex = CASE_STAGES.indexOf(caseRecord.stage);
  const underInvestigation = isUnderInvestigation(caseRecord);

  async function officeResponse(kind: 'approved' | 'more-info' | 'investigation') {
    if (kind === 'approved') {
      if (!window.confirm('המשרד אישר את הבקשה? התיק יעבור לשלב "ממתין לתשלום".')) return;
      await fetch(`/api/cases/${caseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'awaiting-payment', decisionStatus: 'approved', investigationOutcome: '' }),
      });
    } else if (kind === 'more-info') {
      if (!window.confirm('המשרד ביקש השלמה נוספת?')) return;
      const note = window.prompt('מה נדרש להשלים?') ?? '';
      await fetch(`/api/cases/${caseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nextAction: note || 'נדרשת השלמה נוספת מהמשרד' }),
      });
    } else {
      if (!window.confirm('התיק הועבר לחקירה? התיק יסומן באדום עד לסיום החקירה.')) return;
      await fetch(`/api/cases/${caseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisionStatus: 'investigation', investigationOutcome: '' }),
      });
    }
    reload();
  }

  async function concludeInvestigation(outcome: 'approved' | 'rejected') {
    if (outcome === 'approved') {
      if (!window.confirm('החקירה הסתיימה באישור? התיק יעבור ל"ממתין לתשלום".')) return;
      await fetch(`/api/cases/${caseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ investigationOutcome: 'approved', stage: 'awaiting-payment' }),
      });
    } else {
      if (!window.confirm('הבקשה נדחתה? התיק יעבור ל"התקבלה החלטה" עם סטטוס נדחה.')) return;
      await fetch(`/api/cases/${caseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ investigationOutcome: 'rejected', stage: 'decision-received' }),
      });
    }
    reload();
  }

  function pickFilesFor(code: string) {
    uploadCodeRef.current = code;
    checklistUploadRef.current?.click();
  }

  async function uploadForChecklist(files: FileList | null) {
    const code = uploadCodeRef.current;
    if (!files || !files.length || !code) return;
    setUploadingCode(code);
    try {
      const form = new FormData();
      for (const file of Array.from(files)) form.append('file', file);
      form.append('caseId', caseId);
      form.append('checklistCode', code);
      const res = await fetch(`/api/clients/${caseRecord.clientId}/documents`, { method: 'POST', body: form });
      const result = await res.json();
      if (!res.ok || !result.ok) window.alert(result.error || 'ההעלאה נכשלה');
      reload();
    } finally {
      setUploadingCode(null);
      uploadCodeRef.current = null;
      if (checklistUploadRef.current) checklistUploadRef.current.value = '';
    }
  }

  async function setDecision(patch: { decisionStatus?: DecisionStatus; investigationOutcome?: InvestigationOutcome | '' }) {
    await fetch(`/api/cases/${caseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    reload();
  }

  async function toggleTrouble() {
    if (!caseRecord.troubleFlag) {
      const note = window.prompt('מה חסר / מה הבעיה בתיק? (אופציונלי)') ?? '';
      await fetch(`/api/cases/${caseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ troubleFlag: true, troubleNote: note }),
      });
    } else {
      await fetch(`/api/cases/${caseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ troubleFlag: false, troubleNote: '' }),
      });
    }
    reload();
  }

  /** Hand the case to another person (admin: anyone; worker: a manager). */
  async function transferTo(targetId: string, targetName: string) {
    if (!targetId || targetId === caseRecord.handlerId) return;
    if (!window.confirm(`להעביר את התיק ל${targetName}?`)) return;
    const res = await fetch(`/api/cases/${caseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedTo: targetId }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.ok) {
      window.alert(result.error || 'ההעברה נכשלה');
      return;
    }
    // A worker who hands the case on no longer sees it.
    if (result.stillVisible === false) {
      window.alert(`התיק הועבר ל${targetName}`);
      router.push('/cases' as never);
      return;
    }
    reload();
  }

  async function setStage(stage: CaseStage) {
    if (stage === caseRecord.stage) return;
    if (!window.confirm(`לעדכן את שלב התיק ל"${stageLabelOf(config, stage)}"?`)) return;
    setSavingStage(true);
    try {
      await fetch(`/api/cases/${caseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      reload();
    } finally {
      setSavingStage(false);
    }
  }

  async function updateChecklistStatus(code: string, status: ChecklistStatus) {
    await fetch(`/api/cases/${caseId}/checklist`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, status }),
    });
    reload();
  }

  async function removeChecklistItem(code: string, label: string) {
    if (!window.confirm(`להסיר את "${label}" מרשימת המסמכים הנדרשים?`)) return;
    await fetch(`/api/cases/${caseId}/checklist?code=${encodeURIComponent(code)}`, { method: 'DELETE' });
    setSelectedCodes((prev) => prev.filter((c) => c !== code));
    reload();
  }

  function toggleSelected(code: string) {
    setSelectedCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function removeSelected() {
    if (!selectedCodes.length) return;
    if (!window.confirm(`להסיר ${selectedCodes.length} מסמכים מהרשימה?`)) return;
    await fetch(`/api/cases/${caseId}/checklist?codes=${selectedCodes.map(encodeURIComponent).join(',')}`, { method: 'DELETE' });
    setSelectedCodes([]);
    reload();
  }

  async function clearChecklist() {
    if (!window.confirm('לרוקן את כל רשימת המסמכים הנדרשים בתיק זה? אפשר תמיד להעלות מסמכים בחופשיות.')) return;
    await fetch(`/api/cases/${caseId}/checklist?clear=1`, { method: 'DELETE' });
    setSelectedCodes([]);
    reload();
  }

  async function deleteThisCase() {
    if (!window.confirm(`למחוק את התיק "${caseRecord.title}"?\nכל המסמכים והתשלומים של התיק יימחקו לצמיתות.`)) return;
    if (!window.confirm('אישור סופי — הפעולה בלתי הפיכה. למחוק?')) return;
    const res = await fetch(`/api/cases/${caseId}`, { method: 'DELETE' });
    if (res.ok) {
      router.push(`/clients/${caseRecord.clientId}` as never);
    } else {
      const d = await res.json().catch(() => ({}));
      window.alert(d.error || 'מחיקת התיק נכשלה');
    }
  }

  async function addChecklistItem(event: React.FormEvent) {
    event.preventDefault();
    if (!newItemLabel.trim() && !newItemCode) return;
    await fetch(`/api/cases/${caseId}/checklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newItemCode ? { code: newItemCode } : { label: newItemLabel }),
    });
    setNewItemLabel('');
    setNewItemCode('');
    reload();
  }

  function startEditDetails() {
    setDetailsForm({
      title: caseRecord.title,
      fee: String(caseRecord.fee ?? 0),
      referenceNumber: caseRecord.referenceNumber || '',
      nextAction: caseRecord.nextAction || '',
      description: caseRecord.description || '',
      notes: caseRecord.notes || '',
      decision: caseRecord.decision || '',
      company: caseRecord.company || 'none',
      caseKind: caseRecord.caseKind || 'new',
    });
    setEditingDetails(true);
  }

  async function saveDetails(event: React.FormEvent) {
    event.preventDefault();
    await fetch(`/api/cases/${caseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...detailsForm, fee: Number(detailsForm.fee) || 0 }),
    });
    setEditingDetails(false);
    reload();
  }

  async function addPayment(event: React.FormEvent) {
    event.preventDefault();
    setPayError('');
    const amount = Number(payForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPayError('נא להזין סכום חיובי');
      return;
    }
    const res = await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: caseRecord.clientId, caseId, amount, method: payForm.method, note: payForm.note || undefined }),
    });
    const result = await res.json();
    if (!res.ok || !result.ok) {
      setPayError(result.error || 'רישום התשלום נכשל');
      return;
    }
    setPayForm({ amount: '', method: 'bank-transfer', note: '' });
    reload();
  }

  async function saveFee() {
    const fee = Number(feeValue);
    if (!Number.isFinite(fee) || fee < 0) return;
    await fetch(`/api/cases/${caseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fee }),
    });
    setEditingFee(false);
    reload();
  }

  async function setPaymentOverride(value: 'paid' | 'unpaid' | 'auto') {
    await fetch(`/api/cases/${caseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentStatusOverride: value }),
    });
    reload();
  }

  function startEditPayment(p: { id: string; amount: number; method: string }) {
    setEditingPayId(p.id);
    setPayEdit({ amount: String(p.amount), method: p.method });
  }

  async function savePaymentEdit(paymentId: string) {
    const amount = Number(payEdit.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    await fetch(`/api/payments/${paymentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, method: payEdit.method }),
    });
    setEditingPayId(null);
    reload();
  }

  async function deletePaymentRow(paymentId: string) {
    if (!window.confirm('למחוק את התשלום?')) return;
    await fetch(`/api/payments/${paymentId}`, { method: 'DELETE' });
    reload();
  }

  const availableTemplates = config.documentTemplates.filter(
    (t) => !caseRecord.checklist.some((item) => item.code === t.code),
  );
  const checklistOptions = caseRecord.checklist
    .filter((item) => item.status === 'missing' || item.status === 'resubmit-needed' || item.status === 'received')
    .map((item) => ({ code: item.code, label: item.label }));

  return (
    <div>
      <Link className="case-back-link" href="/cases">← כל התיקים</Link>
      {caseRecord.troubleFlag && (
        <div className="trouble-banner">
          🚩 התיק מסומן כתקוע / נדרשת השלמה{caseRecord.troubleNote ? `: ${caseRecord.troubleNote}` : ''}
          <button type="button" className="doc-action-btn" onClick={toggleTrouble} style={{ marginInlineStart: 12 }}>
            הסר סימון
          </button>
        </div>
      )}
      <div className="hero">
        <div>
          <span className="case-id-badge">{caseRecord.id}</span>
          {caseRecord.caseKind === 'renewal' && <span className="kind-badge">חידוש</span>}
          <h1 style={{ margin: '6px 0 4px' }}>{caseRecord.title}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {data.client && (
              <>
                <Link className="text-link" href={`/clients/${caseRecord.clientId}` as never}>{data.client.fullName}</Link>
                {' · '}
              </>
            )}
            {caseRecord.company && caseRecord.company !== 'none' && (
              <>
                <CompanyChip company={caseRecord.company} />{' '}
              </>
            )}
            {caseRecord.officeName}
            {caseRecord.referenceNumber && <> · מס׳ תיק במשרד: <span dir="ltr">{caseRecord.referenceNumber}</span></>}
          </p>
        </div>
        <div className="hero-actions">
          {!caseRecord.troubleFlag && (
            <button type="button" className="button button-secondary button-compact trouble-toggle" onClick={toggleTrouble}>
              🚩 סמן כתקוע
            </button>
          )}
          {data.canAssign ? (
            <select
              className="assign-select"
              value={caseRecord.handlerId}
              onChange={(e) => {
                const target = [...data.managers, ...data.workers].find((p) => p.id === e.target.value);
                if (target) void transferTo(target.id, target.name);
              }}
              title="מי מטפל בתיק — בחירה מעבירה את התיק"
            >
              <optgroup label="מנהלים">
                {data.managers.map((m) => (
                  <option key={m.id} value={m.id}>🧑‍💼 {m.name}</option>
                ))}
              </optgroup>
              {data.workers.length > 0 && (
                <optgroup label="עובדים">
                  {data.workers.map((w) => (
                    <option key={w.id} value={w.id}>👤 {w.name}</option>
                  ))}
                </optgroup>
              )}
              {/* A handler who has since been deactivated still shows as current. */}
              {![...data.managers, ...data.workers].some((p) => p.id === caseRecord.handlerId) && (
                <option value={caseRecord.handlerId}>👤 {caseRecord.handlerName || caseRecord.handlerId}</option>
              )}
            </select>
          ) : (
            <>
              <span className="badge">👤 {caseRecord.handlerName || 'אני'}</span>
              {data.canTransferToManager &&
                data.managers.length > 0 &&
                (data.managers.length === 1 ? (
                  <button
                    type="button"
                    className="button button-secondary button-compact transfer-btn"
                    onClick={() => transferTo(data.managers[0].id, data.managers[0].name)}
                  >
                    ↩ העבר למנהל
                  </button>
                ) : (
                  <select
                    className="assign-select"
                    value=""
                    onChange={(e) => {
                      const target = data.managers.find((m) => m.id === e.target.value);
                      if (target) void transferTo(target.id, target.name);
                    }}
                    title="העברת התיק למנהל"
                  >
                    <option value="">↩ העבר למנהל…</option>
                    {data.managers.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                ))}
            </>
          )}
          {caseRecord.missingItems > 0 && <span className="badge danger">{caseRecord.missingItems} מסמכים חסרים</span>}
          {caseRecord.decisionStatus && (
            <span
              className={`badge ${
                caseRecord.investigationOutcome === 'rejected' || underInvestigation
                  ? 'danger'
                  : caseRecord.decisionStatus === 'approved' || caseRecord.investigationOutcome === 'approved'
                    ? 'good'
                    : 'warn'
              }`}
            >
              {caseRecord.decisionStatus === 'investigation'
                ? underInvestigation
                  ? '🔍 בחקירה'
                  : `חקירה → ${INVESTIGATION_OUTCOME_LABELS[caseRecord.investigationOutcome!]}`
                : DECISION_LABELS[caseRecord.decisionStatus]}
            </span>
          )}
          <span className={`badge ${caseRecord.finance.status === 'paid' ? 'good' : caseRecord.finance.status === 'partial' ? 'warn' : 'danger'}`}>
            {PAYMENT_STATUS_LABELS[caseRecord.finance.status]}
            {caseRecord.finance.balance > 0 && ` · יתרה ${shekel(caseRecord.finance.balance)}`}
          </span>
          {data.canAssign && (
            <button type="button" className="button button-secondary button-compact danger-btn" onClick={deleteThisCase} title="מחיקת התיק">
              🗑 מחק תיק
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="stage-bar-wrap">
          <div className="stage-bar">
            {CASE_STAGES.map((stage, index) => (
              <button
                key={stage}
                type="button"
                className={`stage-step ${index < stageIndex ? 'done' : ''} ${stage === caseRecord.stage ? 'current' : ''}`}
                onClick={() => setStage(stage)}
                disabled={savingStage}
                style={{ background: 'none', border: 'none', padding: 0 }}
                title={`עבור לשלב: ${stageLabelOf(config, stage)}`}
              >
                <span className="stage-dot" />
                <span className="stage-label">{stageLabelOf(config, stage)}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          לחיצה על שלב מעדכנת את מצב התיק. נפתח {formatDate(caseRecord.openedAt)}
          {caseRecord.submittedAt && ` · הוגש ${formatDate(caseRecord.submittedAt)}`}
          {caseRecord.closedAt && ` · נסגר ${formatDate(caseRecord.closedAt)}`}
        </p>
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <div className="section-heading">
              <h3 style={{ margin: 0 }}>מסמכים נדרשים</h3>
              <span className="muted" style={{ fontSize: 12 }}>
                {caseRecord.checklist.filter((i) => i.status === 'approved' || i.status === 'received').length}/
                {caseRecord.checklist.filter((i) => i.status !== 'not-applicable').length} התקבלו
              </span>
            </div>
            {caseRecord.checklist.length > 0 && (
              <div className="split" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <label className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={selectedCodes.length === caseRecord.checklist.length}
                    onChange={(e) => setSelectedCodes(e.target.checked ? caseRecord.checklist.map((i) => i.code) : [])}
                  />
                  בחר הכל
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {selectedCodes.length > 0 && (
                    <button type="button" className="doc-action-btn reject" onClick={removeSelected}>
                      🗑 הסר נבחרים ({selectedCodes.length})
                    </button>
                  )}
                  <button type="button" className="doc-action-btn reject" onClick={clearChecklist}>
                    נקה רשימה
                  </button>
                </div>
              </div>
            )}
            {caseRecord.checklist.length === 0 && (
              <p className="muted">אין רשימת מסמכים בתיק — אפשר להעלות מסמכים בחופשיות בכרטיס &quot;מסמכי התיק&quot;, או להוסיף פריטים לרשימה למטה.</p>
            )}
            <input
              ref={checklistUploadRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => void uploadForChecklist(e.target.files)}
            />
            {caseRecord.checklist.map((item) => (
              <div key={item.code} className="doc-row">
                <input
                  type="checkbox"
                  checked={selectedCodes.includes(item.code)}
                  onChange={() => toggleSelected(item.code)}
                  title="בחר להסרה מרובה"
                  style={{ marginTop: 3 }}
                />
                <div className="doc-name">
                  {item.label}
                  {item.code === BLANK_CONTRACT_CODE && data.hasBlankContract && (
                    <a className="mini-link" href="/api/templates/blank-contract" style={{ display: 'block', fontSize: 12 }}>
                      ⬇ הורדת טופס ריק למילוי
                    </a>
                  )}
                  {item.documentIds.length > 0 && (
                    <span className="doc-file-chips">
                      {item.documentIds.map((docId) => {
                        const doc = data.documents.find((d) => d.id === docId);
                        if (!doc) return null;
                        return (
                          <a key={docId} className="doc-file-chip" href={`/api/documents/${docId}`} target="_blank" rel="noreferrer" title={doc.label || doc.originalName}>
                            📎 {doc.label || doc.originalName}
                          </a>
                        );
                      })}
                    </span>
                  )}
                  {item.note && <span className="muted" style={{ display: 'block', fontSize: 11 }}>{item.note}</span>}
                </div>
                <span className={`doc-status-badge ${item.status === 'missing' ? 'not-uploaded' : item.status === 'received' ? 'uploaded' : item.status === 'in-review' ? 'under-review' : item.status}`}>
                  {CHECKLIST_STATUS_LABELS[item.status]}
                </span>
                <div className="doc-actions">
                  <button
                    type="button"
                    className="doc-action-btn approve"
                    disabled={uploadingCode === item.code}
                    onClick={() => pickFilesFor(item.code)}
                    title="העלאת קבצים למסמך זה — אפשר לבחור כמה קבצים יחד"
                  >
                    {uploadingCode === item.code ? '⏳ מעלה…' : '⬆ העלאה'}
                  </button>
                  {CHECKLIST_ACTIONS.filter((action) => action.status !== item.status)
                    .slice(0, 3)
                    .map((action) => (
                      <button
                        key={action.status}
                        type="button"
                        className={`doc-action-btn ${action.className || ''}`}
                        onClick={() => updateChecklistStatus(item.code, action.status)}
                      >
                        {action.label}
                      </button>
                    ))}
                  <button type="button" className="doc-action-btn reject" onClick={() => removeChecklistItem(item.code, item.label)}>
                    ✕
                  </button>
                </div>
              </div>
            ))}

            <form onSubmit={addChecklistItem} style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <select
                value={newItemCode}
                onChange={(e) => setNewItemCode(e.target.value)}
                style={{ flex: 1, minWidth: 180, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--line)' }}
              >
                <option value="">בחר מהרשימה…</option>
                {availableTemplates.map((t) => (
                  <option key={t.code} value={t.code}>{t.label}</option>
                ))}
              </select>
              <input
                placeholder="או מסמך מותאם אישית…"
                value={newItemLabel}
                onChange={(e) => setNewItemLabel(e.target.value)}
                disabled={Boolean(newItemCode)}
                style={{ flex: 1, minWidth: 180, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--line)' }}
              />
              <button className="button button-compact" type="submit">+ הוסף</button>
            </form>
          </div>

          <div className="card">
            <div className="section-heading">
              <h3 style={{ margin: 0 }}>מסמכי התיק</h3>
              <Link className="mini-link" href={`/clients/${caseRecord.clientId}` as never}>לתיקיית הלקוח המלאה ←</Link>
            </div>
            <DocumentsPanel
              clientId={caseRecord.clientId}
              caseId={caseId}
              documents={data.documents}
              checklistOptions={checklistOptions}
              clientContact={data.client ? { email: data.client.email, phone: data.client.phone } : undefined}
              onChanged={reload}
            />
          </div>
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          {underInvestigation && (
            <div className="card investigation-card">
              <h3 style={{ marginTop: 0, color: 'var(--danger)' }}>🔍 התיק בחקירה</h3>
              <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
                ממתין למסקנת החקירה. עדכן כאן ברגע שמתקבלת תשובה:
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" className="button button-compact" onClick={() => concludeInvestigation('approved')}>
                  ✓ אושר — ממתין לתשלום
                </button>
                <button type="button" className="button button-secondary button-compact trouble-toggle" onClick={() => concludeInvestigation('rejected')}>
                  ✕ נדחה
                </button>
              </div>
            </div>
          )}

          {caseRecord.stage === 'action-required' && !underInvestigation && (
            <div className="card decision-card">
              <h3 style={{ marginTop: 0 }}>תגובת המשרד</h3>
              <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>מה המשרד השיב?</p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" className="button button-compact" onClick={() => officeResponse('approved')}>
                  ✓ אושר — ממתין לתשלום
                </button>
                <button type="button" className="button button-secondary button-compact" onClick={() => officeResponse('more-info')}>
                  📄 נדרשת השלמה נוספת
                </button>
                <button type="button" className="button button-secondary button-compact trouble-toggle" onClick={() => officeResponse('investigation')}>
                  🔍 חקירה
                </button>
              </div>
            </div>
          )}

          {(caseRecord.stage === 'decision-received' || caseRecord.stage === 'closed' || caseRecord.decisionStatus) && !underInvestigation && caseRecord.stage !== 'action-required' && (
            <div className="card decision-card">
              <h3 style={{ marginTop: 0 }}>החלטת המשרד</h3>
              <div className="decision-row">
                <span className="muted" style={{ fontSize: 13 }}>מה התקבל?</span>
                <div className="language-switch">
                  <button
                    type="button"
                    className={`language-option ${caseRecord.decisionStatus === 'approved' ? 'active' : ''}`}
                    onClick={() => setDecision({ decisionStatus: 'approved', investigationOutcome: '' })}
                  >
                    ✓ אושר
                  </button>
                  <button
                    type="button"
                    className={`language-option ${caseRecord.decisionStatus === 'investigation' ? 'active' : ''}`}
                    onClick={() => setDecision({ decisionStatus: 'investigation' })}
                  >
                    🔍 חקירה
                  </button>
                </div>
              </div>
              {caseRecord.decisionStatus === 'investigation' && (
                <div className="decision-row">
                  <span className="muted" style={{ fontSize: 13 }}>תוצאת החקירה:</span>
                  <div className="language-switch">
                    <button
                      type="button"
                      className={`language-option ${caseRecord.investigationOutcome === 'approved' ? 'active' : ''}`}
                      onClick={() => setDecision({ investigationOutcome: 'approved' })}
                    >
                      ✓ אושר
                    </button>
                    <button
                      type="button"
                      className={`language-option outcome-rejected ${caseRecord.investigationOutcome === 'rejected' ? 'active' : ''}`}
                      onClick={() => setDecision({ investigationOutcome: 'rejected' })}
                    >
                      ✕ נדחה
                    </button>
                  </div>
                </div>
              )}
              {caseRecord.investigationOutcome === 'rejected' && (
                <p className="form-error" style={{ marginBottom: 0 }}>הבקשה נדחתה לאחר חקירה.</p>
              )}
            </div>
          )}

          <div className="card">
            <div className="section-heading">
              <h3 style={{ margin: 0 }}>פרטי התיק</h3>
              {!editingDetails && (
                <button type="button" className="button button-secondary button-compact" onClick={startEditDetails}>עריכה</button>
              )}
            </div>
            {!editingDetails ? (
              <div className="review-grid">
                <div className="review-row">
                  <span className="muted">עובד מטפל</span>
                  <strong>{caseRecord.handlerName || 'מנהל'}</strong>
                </div>
                <div className="review-row"><span className="muted">חברה מטפלת</span><strong>{optionLabel(config.companies, caseRecord.company || 'none', '—')}</strong></div>
                <div className="review-row"><span className="muted">סוג התיק</span><strong>{CASE_KIND_LABELS[caseRecord.caseKind || 'new']}</strong></div>
                <div className="review-row"><span className="muted">שכר טרחה</span><strong>{shekel(caseRecord.fee)}</strong></div>
                <div className="review-row"><span className="muted">שולם</span><strong>{shekel(caseRecord.finance.paid)}</strong></div>
                <div className="review-row"><span className="muted">פעולה הבאה</span><span>{caseRecord.nextAction || '—'}</span></div>
                <div className="review-row"><span className="muted">מס׳ תיק במשרד</span><span dir="ltr">{caseRecord.referenceNumber || '—'}</span></div>
                {caseRecord.description && <div className="review-row"><span className="muted">תיאור</span><span>{caseRecord.description}</span></div>}
                {caseRecord.decision && <div className="review-row"><span className="muted">החלטה</span><span>{caseRecord.decision}</span></div>}
                {caseRecord.notes && <div className="review-row"><span className="muted">הערות</span><span style={{ whiteSpace: 'pre-wrap' }}>{caseRecord.notes}</span></div>}
              </div>
            ) : (
              <form onSubmit={saveDetails}>
                <div className="form-grid cols-2">
                  <div className="field"><label>נושא התיק</label><input value={detailsForm.title} onChange={(e) => setDetailsForm({ ...detailsForm, title: e.target.value })} /></div>
                  <div className="field">
                    <label>חברה מטפלת</label>
                    <select value={detailsForm.company} onChange={(e) => setDetailsForm({ ...detailsForm, company: e.target.value })}>
                      {config.companies.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>סוג התיק</label>
                    <select value={detailsForm.caseKind} onChange={(e) => setDetailsForm({ ...detailsForm, caseKind: e.target.value })}>
                      {Object.entries(CASE_KIND_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field"><label>שכר טרחה (₪)</label><input type="number" min="0" value={detailsForm.fee} onChange={(e) => setDetailsForm({ ...detailsForm, fee: e.target.value })} /></div>
                  <div className="field"><label>מס׳ תיק במשרד</label><input value={detailsForm.referenceNumber} onChange={(e) => setDetailsForm({ ...detailsForm, referenceNumber: e.target.value })} /></div>
                  <div className="field"><label>פעולה הבאה</label><input value={detailsForm.nextAction} onChange={(e) => setDetailsForm({ ...detailsForm, nextAction: e.target.value })} /></div>
                </div>
                <div className="field"><label>תיאור</label><textarea rows={2} value={detailsForm.description} onChange={(e) => setDetailsForm({ ...detailsForm, description: e.target.value })} /></div>
                <div className="field"><label>החלטת המשרד</label><textarea rows={2} value={detailsForm.decision} onChange={(e) => setDetailsForm({ ...detailsForm, decision: e.target.value })} /></div>
                <div className="field"><label>הערות</label><textarea rows={3} value={detailsForm.notes} onChange={(e) => setDetailsForm({ ...detailsForm, notes: e.target.value })} /></div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="button" type="submit">שמור</button>
                  <button className="button button-secondary" type="button" onClick={() => setEditingDetails(false)}>ביטול</button>
                </div>
              </form>
            )}
          </div>

          {data.canManagePayments && (
          <div className="card">
            <div className="section-heading">
              <h3 style={{ margin: 0 }}>תשלומים לתיק</h3>
              <span className={`badge ${caseRecord.finance.status === 'paid' ? 'good' : caseRecord.finance.status === 'partial' ? 'warn' : 'danger'}`}>
                {PAYMENT_STATUS_LABELS[caseRecord.finance.status]}{caseRecord.finance.overridden && ' (ידני)'}
              </span>
            </div>
            <div className="receipt-calc" style={{ marginTop: 0, marginBottom: 12 }}>
              <div className="receipt-calc-row" style={{ alignItems: 'center' }}>
                <span>שכר טרחה (חוב)</span>
                {editingFee ? (
                  <span style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="number"
                      min="0"
                      value={feeValue}
                      onChange={(e) => setFeeValue(e.target.value)}
                      style={{ width: 100, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text)' }}
                    />
                    <button type="button" className="doc-action-btn approve" onClick={saveFee}>✓</button>
                    <button type="button" className="doc-action-btn" onClick={() => setEditingFee(false)}>✕</button>
                  </span>
                ) : (
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {shekel(caseRecord.finance.fee)}
                    <button type="button" className="doc-action-btn" onClick={() => { setFeeValue(String(caseRecord.finance.fee)); setEditingFee(true); }}>ערוך</button>
                  </span>
                )}
              </div>
              <div className="receipt-calc-row"><span>שולם</span><span>{shekel(caseRecord.finance.paid)}</span></div>
              <div className="receipt-calc-row total"><span>יתרה</span><span>{shekel(caseRecord.finance.balance)}</span></div>
            </div>

            <div className="split" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>סימון סטטוס:</span>
              <div className="language-switch">
                <button type="button" className={`language-option ${caseRecord.paymentStatusOverride === 'paid' ? 'active' : ''}`} onClick={() => setPaymentOverride('paid')}>שולם</button>
                <button type="button" className={`language-option ${caseRecord.paymentStatusOverride === 'unpaid' ? 'active' : ''}`} onClick={() => setPaymentOverride('unpaid')}>לא שולם</button>
                <button type="button" className={`language-option ${!caseRecord.paymentStatusOverride ? 'active' : ''}`} onClick={() => setPaymentOverride('auto')}>אוטומטי</button>
              </div>
            </div>

            {data.payments.length > 0 && (
              <ul className="list" style={{ marginBottom: 14 }}>
                {data.payments.map((p) => (
                  <li key={p.id} className="split" style={{ fontSize: 13, gap: 8 }}>
                    {editingPayId === p.id ? (
                      <>
                        <span style={{ display: 'flex', gap: 6, flex: 1, flexWrap: 'wrap' }}>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={payEdit.amount}
                            onChange={(e) => setPayEdit({ ...payEdit, amount: e.target.value })}
                            style={{ width: 90, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text)' }}
                          />
                          <select
                            value={payEdit.method}
                            onChange={(e) => setPayEdit({ ...payEdit, method: e.target.value })}
                            style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text)' }}
                          >
                            {config.paymentMethods.map((m) => (
                              <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                          </select>
                        </span>
                        <span style={{ display: 'flex', gap: 4 }}>
                          <button type="button" className="doc-action-btn approve" onClick={() => savePaymentEdit(p.id)}>✓ שמור</button>
                          <button type="button" className="doc-action-btn" onClick={() => setEditingPayId(null)}>ביטול</button>
                        </span>
                      </>
                    ) : (
                      <>
                        <span>{formatDate(p.paidAt)} · {optionLabel(config.paymentMethods, p.method, p.method)}{p.note ? ` · ${p.note}` : ''}</span>
                        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <strong>{shekel(p.amount)}</strong>
                          <button type="button" className="doc-action-btn" onClick={() => startEditPayment(p)}>ערוך</button>
                          <button type="button" className="doc-action-btn reject" onClick={() => deletePaymentRow(p.id)}>✕</button>
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={addPayment} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="סכום ₪"
                value={payForm.amount}
                onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                style={{ flex: 1, minWidth: 110, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--line)' }}
              />
              <select
                value={payForm.method}
                onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}
                style={{ flex: 1, minWidth: 130, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--line)' }}
              >
                {config.paymentMethods.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <button className="button button-compact" type="submit">רשום תשלום</button>
              {payError && <p className="form-error" style={{ width: '100%' }}>{payError}</p>}
            </form>
          </div>
          )}

          <div className="card">
            <h3 style={{ marginTop: 0 }}>פעילות בתיק</h3>
            {data.activity.length === 0 ? (
              <p className="muted">אין פעילות.</p>
            ) : (
              <div className="timeline">
                {data.activity.map((entry) => (
                  <div key={entry.id} className="step">
                    <div className="muted" style={{ fontSize: 11 }}>{formatDate(entry.at)}</div>
                    <div style={{ fontSize: 13 }}>{entry.summary}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
