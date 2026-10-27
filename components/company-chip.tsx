'use client';

import type { CSSProperties } from 'react';
import { useConfig } from '@/components/config-provider';
import { companyColor, optionLabel } from '@/lib/domain';

/** Coloured label for a case's operating company (מילגם / אלונים / מעוף…). */
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

/** Props that add the company's coloured stripe to a case card. */
export function useCompanyStripe() {
  const config = useConfig();
  return (company?: string, className = '') => {
    const color = companyColor(config, company);
    return {
      className: `${className}${color ? ' has-company' : ''}`,
      style: color ? ({ '--co': color } as CSSProperties) : undefined,
    };
  };
}
