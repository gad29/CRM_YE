import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { ReminderChannel, TaskPriority, TaskWatchKind } from '@/lib/domain';
import { caseVisibleTo, clientVisibleTo, createTask, getCase, getClient, listVisibleTasks } from '@/lib/store';
import { isWatchKind, parseDetailFields, resolveWatchedTasks, watchResolution } from '@/lib/task-watch';
import { assigneeContact, getUser } from '@/lib/users';
import { actorId, getViewer } from '@/lib/viewer';

/**
 *   ?caseId= / ?clientId=   only the tasks about that case / client
 *   ?open=1                 only open ones
 */
export async function GET(request: NextRequest) {
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });

  // Reminders whose gap was filled close themselves before anyone sees them.
  await resolveWatchedTasks();

  const params = request.nextUrl.searchParams;
  const caseId = params.get('caseId');
  const clientId = params.get('clientId');
  const openOnly = params.get('open') === '1';
  const visible = (await listVisibleTasks(auth.viewer)).filter(
    (t) => (!caseId || t.caseId === caseId) && (!clientId || t.clientId === clientId) && (!openOnly || t.status === 'open'),
  );

  const tasks = await Promise.all(visible.map(async (task) => {
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
    /** Watch a gap and close by itself once it is filled. */
    watch?: { kind?: string; code?: string; fields?: string[] };
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
  const assigneeId = auth.viewer.role === 'admin' ? body.assigneeId || creator : creator;
  if (assigneeId !== creator && !(await getUser(assigneeId))?.active) {
    return NextResponse.json({ ok: false, error: 'האחראי שנבחר לא נמצא או שאינו פעיל' }, { status: 400 });
  }

  // A task about a case or client must be about one this person can see.
  const caseRecord = body.caseId ? await getCase(body.caseId) : undefined;
  if (body.caseId && (!caseRecord || !caseVisibleTo(caseRecord, auth.viewer))) {
    return NextResponse.json({ ok: false, error: 'התיק לא נמצא' }, { status: 404 });
  }
  const clientId = body.clientId || caseRecord?.clientId;
  const client = clientId ? await getClient(clientId) : undefined;
  if (clientId && (!client || !(await clientVisibleTo(client, auth.viewer)))) {
    return NextResponse.json({ ok: false, error: 'הלקוח לא נמצא' }, { status: 404 });
  }

  let watchKind: TaskWatchKind | undefined;
  let watchRef: string | undefined;
  if (body.watch) {
    const kind = body.watch.kind;
    if (!isWatchKind(kind)) return NextResponse.json({ ok: false, error: 'סוג מעקב לא מוכר' }, { status: 400 });
    if (kind === 'client-details') {
      if (!client) return NextResponse.json({ ok: false, error: 'חסר לקוח למעקב' }, { status: 400 });
      watchRef = parseDetailFields((body.watch.fields || []).join(',')).join(',');
      if (!watchRef) return NextResponse.json({ ok: false, error: 'לא נבחרו פרטים למעקב' }, { status: 400 });
    } else {
      if (!caseRecord) return NextResponse.json({ ok: false, error: 'חסר תיק למעקב' }, { status: 400 });
      if (kind === 'checklist-item') watchRef = body.watch.code;
    }
    const already = await watchResolution({ watchKind: kind, watchRef, caseId: caseRecord?.id, clientId });
    if (already) return NextResponse.json({ ok: false, error: `אין צורך בתזכורת: ${already}` }, { status: 400 });
    watchKind = kind;
  }

  const record = await createTask({
    title: body.title,
    notes: body.notes,
    dueAt: body.dueAt,
    remindAt: body.remindAt,
    reminderChannels: body.reminderChannels,
    priority: body.priority,
    assigneeId,
    clientId,
    caseId: caseRecord?.id,
    createdBy: creator,
    watchKind,
    watchRef,
  });
  if (!record) return NextResponse.json({ ok: false, error: 'יצירת המשימה נכשלה' }, { status: 400 });
  return NextResponse.json({ ok: true, data: record }, { status: 201 });
}
