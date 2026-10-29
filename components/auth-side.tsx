'use client';

// The left (in RTL: right) panel of the sign-in, password-reset screens.
import { useEffect, useState, type CSSProperties } from 'react';
import { COMPANY_COLORS, COMPANY_LABELS } from '@/lib/domain';

export function useBranding() {
  const [brand, setBrand] = useState({ businessName: '', sidebarSubtitle: '' });
  useEffect(() => {
    fetch('/api/branding')
      .then((r) => r.json())
      .then((d) => d.ok && setBrand(d.data))
      .catch(() => null);
  }, []);
  return brand;
}

export function AuthSide({ businessName, sidebarSubtitle }: { businessName: string; sidebarSubtitle: string }) {
  return (
    <aside className="auth-side" aria-hidden="true">
      <div className="row" style={{ gap: 12 }}>
        <span className="brand-mark">{(businessName || 'C').trim()[0]}</span>
        <div>
          <div className="brand-name" style={{ color: '#fff' }}>{businessName || ' '}</div>
          <div className="small muted">{sidebarSubtitle}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 28 }}>
        <div className="auth-folders">
          {(['maof', 'milgam', 'alonim'] as const).map((c) => (
            <div key={c} className="folder" style={{ '--co': COMPANY_COLORS[c] } as CSSProperties}>
              <span className="folder-tab">{COMPANY_LABELS[c]}</span>
            </div>
          ))}
        </div>
        <p className="auth-quote">כל משפחה, כל תיק וכל מסמך — במקום אחד, עם השלב הבא תמיד לפניכם.</p>
      </div>
      <div className="small muted">כניסה לצוות המשרד בלבד</div>
    </aside>
  );
}

