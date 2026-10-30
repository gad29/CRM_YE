'use client';

// Shown in place of an area (tasks, chat, payments) that was switched off in
// Settings → ממשק. Admins get the way back; everyone else just a plain note.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useSession } from '@/components/session-provider';
import { Empty } from '@/components/ui/bits';

export const INTERFACE_SETTINGS_HREF = '/admin/settings?tab=interface';

export function ModuleOff({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  const { me } = useSession();
  return (
    <Empty
      icon={icon}
      title={title}
      action={
        me?.isAdmin ? (
          <Link className="button button-secondary" href={INTERFACE_SETTINGS_HREF as never}>
            להפעלה בהגדרות
          </Link>
        ) : undefined
      }
    >
      {children ?? (me?.isAdmin ? 'האזור הזה כבוי בהגדרות המערכת.' : 'האזור הזה לא בשימוש במשרד. אם צריך אותו, פנו למנהל.')}
    </Empty>
  );
}
