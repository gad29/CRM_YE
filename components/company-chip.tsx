'use client';

import type { CSSProperties } from 'react';
import { useConfig } from '@/components/config-provider';
import { companyColor, optionLabel } from '@/lib/domain';

/** The company's colour as a `--co` style, for `.folder`, `.company-chip`, `.filter-chip .swatch`. */
export function useCompanyStyle() {
  const config = useConfig();
  return (company?: string): CSSProperties | undefined => {
    const color = companyColor(config, company);
    return color ? ({ '--co': color } as CSSProperties) : undefined;
  };
}

/** Coloured label for a case's operating company (מילגם / אלונים / מעוף…) in lists and headers. */
export function CompanyChip({ company }: { company?: string }) {
  const config = useConfig();
  if (!company || company === 'none') return null;
  const color = companyColor(config, company);
  return (
    <span className="company-chip" style={color ? ({ '--co': color } as CSSProperties) : undefined}>
      {optionLabel(config.companies, company, '')}
    </span>
  );
}

/**
 * The tab on top of a `.folder` card, in the company's colour. Place it as the
 * first child of an element with class `folder`; a case with no company gets
 * a plain paper tab.
 */
export function FolderTab({ company, children }: { company?: string; children?: React.ReactNode }) {
  const config = useConfig();
  const color = companyColor(config, company);
  const label = company && company !== 'none' ? optionLabel(config.companies, company, '') : 'ללא חברה';
  return (
    <span className={`folder-tab ${color ? '' : 'none'}`} style={color ? ({ '--co': color } as CSSProperties) : undefined}>
      {label}
      {children}
    </span>
  );
}
