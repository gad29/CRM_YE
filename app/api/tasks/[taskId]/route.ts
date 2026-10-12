import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { ReminderChannel, TaskPriority } from '@/lib/domain';
import { deleteTask, getTask, taskVisibleTo, updateTask } from '@/lib/store';
import { getViewer } from '@/lib/viewer';

type Params = { params: Promise<{ taskId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });
  const { taskId } = await params;
  const existing = await getTask(taskId);
  if (!existing || !taskVisibleTo(existing, auth.viewer)) {
    return NextResponse.json({ ok: false, error: 'Task not found' }, { status: 404 });
  }

  let body: {
    title?: string;
    notes?: string;
    dueAt?: string | null;
    remindAt?: string | null;
    reminderChannels?: ReminderChannel[];
    priority?: TaskPriority;
    assigneeId?: string;
    status?: 'open' | 'done';
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  // Only the admin may reassign tasks.
  if (body.assigneeId !== undefined && auth.viewer.role !== 'admin') {
    delete body.assigneeId;
  }

  const updated = await updateTask(taskId, body);
  if (!updated) return NextResponse.json({ ok: false, error: 'Task not found' }, { status: 404 });
  return NextResponse.json({ ok: true, data: updated });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });
  const { taskId } = await params;
  const existing = await getTask(taskId);
  if (!existing || !taskVisibleTo(existing, auth.viewer)) {
    return NextResponse.json({ ok: false, error: 'Task not found' }, { status: 404 });
  }
  await deleteTask(taskId);
  return NextResponse.json({ ok: true });
}
