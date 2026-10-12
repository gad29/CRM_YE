import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { ReminderChannel, TaskPriority } from '@/lib/domain';
import { assigneeContact, createTask, getCase, getClient, listVisibleTasks } from '@/lib/store';
import { actorId, getViewer } from '@/lib/viewer';

export async function GET() {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });

  const tasks = await Promise.all((await listVisibleTasks(auth.viewer)).map(async (task) => {
    const assignee = await assigneeContact(task.assigneeId);
    const client = task.clientId ? await getClient(task.clientId) : undefined;
    const caseRecord = task.caseId ? await getCase(task.caseId) : undefined;
    return {
      ...task,
      assigneeName: assignee.name,
      clientName: client?.fullName || '',
      caseTitle: caseRecord?.title || '',
    };
  }));

  return NextResponse.json({ ok: true, data: tasks });
}

export async function POST(request: NextRequest) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });

  let body: {
    title?: string;
    notes?: string;
    dueAt?: string;
    remindAt?: string;
    reminderChannels?: ReminderChannel[];
    priority?: TaskPriority;
    assigneeId?: string;
    clientId?: string;
    caseId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  if (!body.title?.trim()) {
    return NextResponse.json({ ok: false, error: 'כותרת המשימה היא שדה חובה' }, { status: 400 });
  }

  const creator = actorId(auth.session);
  // Workers can only create tasks for themselves; the admin can assign to anyone.
  const assigneeId = auth.viewer.role === 'admin' ? body.assigneeId || 'admin' : creator;

  const record = await createTask({
    title: body.title,
    notes: body.notes,
    dueAt: body.dueAt,
    remindAt: body.remindAt,
    reminderChannels: body.reminderChannels,
    priority: body.priority,
    assigneeId,
    clientId: body.clientId,
    caseId: body.caseId,
    createdBy: creator,
  });
  if (!record) return NextResponse.json({ ok: false, error: 'יצירת המשימה נכשלה' }, { status: 400 });
  return NextResponse.json({ ok: true, data: record }, { status: 201 });
}
