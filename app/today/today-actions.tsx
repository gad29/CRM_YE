'use client';

// The few interactive bits on the (server-rendered) Today screen.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useNewFlow } from '@/components/app-shell';
import { useToast } from '@/components/ui/toast';
import { IconCheck, IconPlus } from '@/components/ui/icons';

export function TodayNewClient() {
  const openWizard = useNewFlow();
  return (
    <button type="button" className="button button-compact" onClick={() => openWizard({ mode: 'client' })}>
      <IconPlus size={16} /> לקוח חדש
    </button>
  );
}

/** Round tick that closes a task in place. */
export function TodayTaskDone({ taskId, title }: { taskId: string; title: string }) {
  const router = useRouter();
  const toast = useToast();
  const [done, setDone] = useState(false);
  async function complete() {
    setDone(true);
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    }).catch(() => null);
    if (!res?.ok) {
      setDone(false);
      toast('סימון המשימה נכשל', 'error');
      return;
    }
    toast('המשימה סומנה כבוצעה');
    router.refresh();
  }
  return (
    <button
      type="button"
      className={`task-tick ${done ? 'on' : ''}`}
      onClick={complete}
      disabled={done}
      aria-label={`סימון "${title}" כבוצעה`}
      title="סימון כבוצעה"
    >
      <IconCheck size={13} />
    </button>
  );
}
