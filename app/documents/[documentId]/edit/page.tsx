import Link from 'next/link';
import { DocumentEditor } from '@/components/document-editor';
import { getDocument } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default async function DocumentEditPage({ params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const record = await getDocument(documentId);

  if (!record) {
    return (
      <div className="landing" dir="rtl">
        <div className="landing-hero">
          <h1 className="landing-title">המסמך לא נמצא</h1>
          <div className="landing-actions">
            <Link className="button" href="/clients">חזרה ללקוחות</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <DocumentEditor
      doc={{
        id: record.id,
        clientId: record.clientId,
        caseId: record.caseId,
        originalName: record.originalName,
        label: record.label,
        mimeType: record.mimeType,
      }}
    />
  );
}
