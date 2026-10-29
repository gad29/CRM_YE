'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { ConfigProvider } from '@/components/config-provider';
import { SessionProvider } from '@/components/session-provider';
import { ToastProvider } from '@/components/ui/toast';

/** Sign-in screens and the full-screen document editor have no sidebar. */
function bare(pathname: string) {
  return pathname === '/login' || pathname === '/forgot' || /^\/documents\/[^/]+\/edit/.test(pathname);
}

export function RouteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <ConfigProvider>
      <ToastProvider>
        {bare(pathname) ? (
          children
        ) : (
          <SessionProvider>
            <AppShell>{children}</AppShell>
          </SessionProvider>
        )}
      </ToastProvider>
    </ConfigProvider>
  );
}
