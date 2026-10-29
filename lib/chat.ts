// Team chat: public channel + private 1:1 conversations, with attachments,
// voice notes and reminders. Messages live in PostgreSQL; attachment files
// stay on disk under DATA_DIR/chat/<channelId>/.
import fs from 'node:fs';
import path from 'node:path';
import {
  PUBLIC_CHANNEL_ID,
  type ChatAttachment,
  type ChatAttachmentKind,
  type ChatChannel,
  type ChatMember,
  type ChatMessage,
  type ReminderChannel,
} from '@/lib/domain';
import { afterCommit, iso, isoOpt, opt, sql, sqlOne, transaction } from '@/lib/db';
import { env } from '@/lib/env';
import { chatMessageNotice } from '@/lib/messages';
import { deliver, directChannelAvailable } from '@/lib/notify';
import { createTask, dataRoot, getConfig, nextId, safeSegment } from '@/lib/store';
import { isAdminRole, listUsers } from '@/lib/users';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;


function nowIso() {
  return new Date().toISOString();
}

function channelFolder(channelId: string) {
  return path.join(dataRoot(), 'chat', safeSegment(channelId));
}

// ── Members ──────────────────────────────────────────────────────────────────

/** Everyone who can take part in the chat: the root admin, extra admins, workers. */
export async function listChatMembers(): Promise<ChatMember[]> {
  // Everyone with an account, the owner included ('admin' — the id chat history uses).
  return (await listUsers()).map(
    (u): ChatMember => ({ id: u.id, name: u.name, role: isAdminRole(u.role) ? 'admin' : 'worker', email: u.email, phone: u.phone, active: u.active }),
  );
}

export async function getChatMember(id: string) {
  return (await listChatMembers()).find((m) => m.id === id);
}

// ── Channels ─────────────────────────────────────────────────────────────────

function toChannel(row: Row): ChatChannel {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    memberIds: row.member_ids ?? [],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function listChannelsRaw(): Promise<ChatChannel[]> {
  return (await sql('SELECT * FROM chat_channels ORDER BY created_at DESC, id')).map(toChannel);
}

/** The team-wide channel everyone can read and post in. */
export async function ensurePublicChannel(): Promise<ChatChannel> {
  await sql(
    `INSERT INTO chat_channels (id, kind, name, member_ids, created_at, updated_at)
     VALUES ($1, 'public', 'צוות — כללי', '{}', $2, $2)
     ON CONFLICT (id) DO NOTHING`,
    [PUBLIC_CHANNEL_ID, nowIso()],
  );
  return toChannel((await sqlOne('SELECT * FROM chat_channels WHERE id = $1', [PUBLIC_CHANNEL_ID]))!);
}

/** Stable id for a 1:1 conversation, independent of who opened it. */
export function directChannelId(a: string, b: string) {
  return `dm-${[a, b].sort().join('--')}`;
}

export async function getOrCreateDirectChannel(a: string, b: string): Promise<ChatChannel | undefined> {
  if (a === b) return undefined;
  if (!(await getChatMember(a)) || !(await getChatMember(b))) return undefined;

  const id = directChannelId(a, b);
  await sql(
    `INSERT INTO chat_channels (id, kind, name, member_ids, created_at, updated_at)
     VALUES ($1, 'direct', '', $2, $3, $3)
     ON CONFLICT (id) DO NOTHING`,
    [id, [a, b].sort(), nowIso()],
  );
  const row = await sqlOne('SELECT * FROM chat_channels WHERE id = $1', [id]);
  return row ? toChannel(row) : undefined;
}

export async function getChannel(channelId: string) {
  if (channelId === PUBLIC_CHANNEL_ID) return ensurePublicChannel();
  const row = await sqlOne('SELECT * FROM chat_channels WHERE id = $1', [channelId]);
  return row ? toChannel(row) : undefined;
}

/** Public channels are open to everyone; DMs only to their two members. */
export function canAccessChannel(channel: ChatChannel, memberId: string) {
  if (channel.kind === 'public') return true;
  return channel.memberIds.includes(memberId);
}

/**
 * Resolve a channel for a member, creating a direct conversation on demand.
 * The conversation list offers a DM with every teammate before any message
 * exists, so the first send/open must materialize that channel.
 */
export async function resolveChannelForMember(channelId: string, memberId: string): Promise<ChatChannel | undefined> {
  const existing = await getChannel(channelId);
  if (existing) return canAccessChannel(existing, memberId) ? existing : undefined;

  const match = /^dm-(.+)--(.+)$/.exec(channelId);
  if (!match) return undefined;
  const [, a, b] = match;
  if (a !== memberId && b !== memberId) return undefined;
  // Guard against a tampered id: both sides must be real members.
  if (!(await getChatMember(a)) || !(await getChatMember(b))) return undefined;
  if (directChannelId(a, b) !== channelId) return undefined;

  return getOrCreateDirectChannel(a, b);
}

// ── Messages ─────────────────────────────────────────────────────────────────

function toMessage(row: Row): ChatMessage {
  return {
    id: row.id,
    channelId: row.channel_id,
    authorId: row.author_id,
    authorName: row.author_name,
    body: opt(row.body),
    attachments: (row.attachments ?? []) as ChatAttachment[],
    reminderTaskId: opt(row.reminder_task_id),
    reminderAt: isoOpt(row.reminder_at),
    reminderChannels: opt(row.reminder_channels) as ReminderChannel[] | undefined,
    readBy: row.read_by ?? [],
    createdAt: iso(row.created_at),
    deletedAt: isoOpt(row.deleted_at),
  };
}

const MESSAGE_ORDER = 'ORDER BY created_at, length(id), id';

/** Messages of a channel oldest→newest; `afterId` returns only newer ones (polling). */
export async function listChannelMessages(channelId: string, options?: { afterId?: string; limit?: number }) {
  if (options?.afterId) {
    const anchor = await sqlOne('SELECT created_at, id FROM chat_messages WHERE id = $1 AND channel_id = $2', [
      options.afterId,
      channelId,
    ]);
    if (anchor) {
      const rows = await sql(
        `SELECT * FROM chat_messages
          WHERE channel_id = $1
            AND (created_at, length(id), id) > ($2::timestamptz, length($3::text), $3::text)
          ${MESSAGE_ORDER}`,
        [channelId, anchor.created_at, anchor.id],
      );
      return rows.map(toMessage);
    }
  }
  const limit = options?.limit ?? 200;
  const rows = await sql(
    `SELECT * FROM (
       SELECT * FROM chat_messages WHERE channel_id = $1
        ORDER BY created_at DESC, length(id) DESC, id DESC LIMIT $2
     ) newest ${MESSAGE_ORDER}`,
    [channelId, limit],
  );
  return rows.map(toMessage);
}

export async function getChatMessage(messageId: string) {
  const row = await sqlOne('SELECT * FROM chat_messages WHERE id = $1', [messageId]);
  return row ? toMessage(row) : undefined;
}

export interface PostMessageInput {
  channelId: string;
  authorId: string;
  body?: string;
  files?: { originalName: string; mimeType: string; buffer: Buffer; kind?: ChatAttachmentKind; durationSec?: number }[];
  /** Attach a reminder: creates a task for the recipient and delivers it on time. */
  reminder?: { at: string; channels: ReminderChannel[] };
  /** Send an immediate email/WhatsApp ping about this message. */
  notify?: boolean;
}

function attachmentKindFor(mimeType: string, requested?: ChatAttachmentKind): ChatAttachmentKind {
  if (requested === 'voice') return 'voice';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'voice';
  return 'file';
}

function sanitizeFileName(name: string) {
  const base = path.basename(name).replace(/[-\\/:*?"<>|\s]/g, '_').trim();
  return base || 'file';
}

export async function postChatMessage(input: PostMessageInput): Promise<ChatMessage | undefined> {
  const channel = await getChannel(input.channelId);
  if (!channel) return undefined;
  const members = await listChatMembers();
  const author = members.find((m) => m.id === input.authorId);
  if (!author) return undefined;
  if (!canAccessChannel(channel, input.authorId)) return undefined;

  const body = input.body?.trim();
  const files = input.files ?? [];
  if (!body && !files.length) return undefined;

  const id = await nextId('MSG', 'chatMessage');
  const attachments: ChatAttachment[] = [];
  const written: string[] = [];
  if (files.length) {
    const folder = channelFolder(channel.id);
    fs.mkdirSync(folder, { recursive: true });
    for (const [index, file] of files.entries()) {
      const kind = attachmentKindFor(file.mimeType, file.kind);
      const safeName = sanitizeFileName(file.originalName || (kind === 'voice' ? 'voice.webm' : 'file'));
      const fileName = `${id}-${index}-${safeName}`;
      const filePath = path.join(folder, fileName);
      fs.writeFileSync(filePath, file.buffer);
      written.push(filePath);
      attachments.push({
        id: `${id}-${index}`,
        fileName,
        originalName: safeName,
        mimeType: file.mimeType || 'application/octet-stream',
        size: file.buffer.length,
        kind,
        durationSec: file.durationSec,
      });
    }
  }

  const message: ChatMessage = {
    id,
    channelId: channel.id,
    authorId: author.id,
    authorName: author.name,
    body: body || undefined,
    attachments,
    readBy: [author.id],
    createdAt: nowIso(),
  };

  // A reminder rides along as a real task, so the reminder scheduler delivers
  // it (email / WhatsApp) at the requested time.
  if (input.reminder?.at) {
    const recipients = channelRecipients(channel, author.id, members);
    const assignee = recipients[0] ?? author.id;
    const task = await createTask({
      title: body || 'תזכורת מהצ׳אט',
      notes: `נשלח בצ׳אט מ${author.name}`,
      dueAt: input.reminder.at,
      remindAt: input.reminder.at,
      reminderChannels: input.reminder.channels ?? [],
      priority: 'normal',
      assigneeId: assignee,
      createdBy: author.id,
    });
    if (task) {
      message.reminderTaskId = task.id;
      message.reminderAt = task.remindAt;
      message.reminderChannels = task.reminderChannels;
    }
  }

  try {
    await transaction(async () => {
      await sql(
        `INSERT INTO chat_messages (id, channel_id, author_id, author_name, body, attachments, reminder_task_id,
                                    reminder_at, reminder_channels, read_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          message.id,
          message.channelId,
          message.authorId,
          message.authorName,
          message.body ?? null,
          JSON.stringify(message.attachments),
          message.reminderTaskId ?? null,
          message.reminderAt ?? null,
          message.reminderChannels ?? null,
          message.readBy,
          message.createdAt,
        ],
      );
      // Bump the channel so conversations sort by latest activity.
      await sql('UPDATE chat_channels SET updated_at = $2 WHERE id = $1', [channel.id, message.createdAt]);
    });
  } catch (error) {
    for (const filePath of written) fs.rmSync(filePath, { force: true });
    throw error;
  }

  if (input.notify) {
    void notifyRecipients(channel, author, message, members);
  }

  return message;
}

/** Email / WhatsApp ping to everyone else in the conversation. */
async function notifyRecipients(channel: ChatChannel, author: ChatMember, message: ChatMessage, members: ChatMember[]) {
  const channels = (['email', 'whatsapp'] as const).filter((c) => directChannelAvailable(c));
  if (!channels.length) return;
  const { businessName } = await getConfig();
  const preview = message.body || (message.attachments.length ? `${message.attachments.length} קבצים` : '');
  const link = `${env.appBaseUrl}/chat?channel=${encodeURIComponent(channel.id)}`;
  const recipients = channelRecipients(channel, author.id, members)
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is ChatMember => Boolean(m));
  for (const recipient of recipients) {
    const notice = chatMessageNotice({
      businessName,
      recipientName: recipient.name,
      authorName: author.name,
      channelName: channel.kind === 'public' ? channel.name : 'הודעה פרטית',
      preview,
      link,
    });
    for (const deliveryChannel of channels) {
      const reachable = deliveryChannel === 'email' ? recipient.email : recipient.phone;
      if (!reachable) continue;
      await deliver({
        channel: deliveryChannel,
        to: { email: recipient.email, phone: recipient.phone },
        message: notice,
        relatedId: message.id,
      });
    }
  }
}

/** Everyone who should receive a message in this channel, excluding the author. */
function channelRecipients(channel: ChatChannel, authorId: string, members: ChatMember[]) {
  const ids = channel.kind === 'public' ? members.filter((m) => m.active).map((m) => m.id) : channel.memberIds;
  return ids.filter((id) => id !== authorId);
}

/** Soft-delete: authors can remove their own message, admins any message. */
export async function deleteChatMessage(messageId: string, actorId: string, actorIsAdmin: boolean) {
  return transaction(async () => {
    const row = await sqlOne('SELECT * FROM chat_messages WHERE id = $1 FOR UPDATE', [messageId]);
    if (!row) return false;
    const message = toMessage(row);
    if (message.authorId !== actorId && !actorIsAdmin) return false;

    await sql("UPDATE chat_messages SET deleted_at = $2, body = NULL, attachments = '[]' WHERE id = $1", [
      messageId,
      nowIso(),
    ]);
    // Remove the files from disk; the row stays as a "deleted" placeholder.
    const folder = channelFolder(message.channelId);
    const paths = message.attachments.map((a) => path.join(folder, path.basename(a.fileName)));
    afterCommit(() => {
      for (const filePath of paths) if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
    return true;
  });
}

export function readAttachment(message: ChatMessage, attachmentId: string) {
  const attachment = message.attachments.find((a) => a.id === attachmentId);
  if (!attachment) return undefined;
  const filePath = path.join(channelFolder(message.channelId), path.basename(attachment.fileName));
  if (!fs.existsSync(filePath)) return undefined;
  return { attachment, buffer: fs.readFileSync(filePath) };
}

// ── Read state & conversation list ───────────────────────────────────────────

export async function markChannelRead(channelId: string, memberId: string) {
  const rows = await sql(
    `UPDATE chat_messages SET read_by = array_append(read_by, $2)
      WHERE channel_id = $1 AND NOT ($2 = ANY(read_by))
      RETURNING id`,
    [channelId, memberId],
  );
  return rows.length > 0;
}

export interface ConversationSummary extends ChatChannel {
  /** Display title for the viewer (DMs show the other participant). */
  title: string;
  otherMemberId?: string;
  otherRole?: 'admin' | 'worker';
  unread: number;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  lastMessageAuthor?: string;
}

function previewOf(message: ChatMessage) {
  if (message.deletedAt) return 'הודעה נמחקה';
  if (message.body) return message.body.slice(0, 60);
  const voice = message.attachments.find((a) => a.kind === 'voice');
  if (voice) return '🎤 הודעה קולית';
  if (message.attachments.length) return `📎 ${message.attachments.length} קבצים`;
  return '';
}

/** Conversations visible to a member: the public channel + their DMs, plus a
 *  placeholder row for every teammate they have not talked to yet. */
export async function listConversations(memberId: string): Promise<ConversationSummary[]> {
  const members = await listChatMembers();
  const me = members.find((m) => m.id === memberId);
  if (!me) return [];

  await ensurePublicChannel();
  const channels = (await listChannelsRaw()).filter((c) => canAccessChannel(c, memberId));
  const channelIds = channels.map((c) => c.id);

  const [lastRows, unreadRows] = await Promise.all([
    sql(
      `SELECT DISTINCT ON (channel_id) * FROM chat_messages
        WHERE channel_id = ANY($1)
        ORDER BY channel_id, created_at DESC, length(id) DESC, id DESC`,
      [channelIds],
    ),
    sql<{ channel_id: string; unread: number }>(
      `SELECT channel_id, count(*)::int AS unread FROM chat_messages
        WHERE channel_id = ANY($1) AND author_id <> $2 AND NOT ($2 = ANY(read_by))
        GROUP BY channel_id`,
      [channelIds, memberId],
    ),
  ]);
  const lastByChannel = new Map(lastRows.map((r) => [r.channel_id as string, toMessage(r)]));
  const unreadByChannel = new Map(unreadRows.map((r) => [r.channel_id, r.unread]));

  const visible: ConversationSummary[] = channels.map((channel) => {
    const last = lastByChannel.get(channel.id);
    const otherId = channel.kind === 'direct' ? channel.memberIds.find((id) => id !== memberId) : undefined;
    const other = otherId ? members.find((m) => m.id === otherId) : undefined;
    return {
      ...channel,
      title: channel.kind === 'public' ? channel.name : other?.name || 'שיחה',
      otherMemberId: otherId,
      otherRole: other?.role,
      unread: unreadByChannel.get(channel.id) ?? 0,
      lastMessageAt: last?.createdAt,
      lastMessagePreview: last ? previewOf(last) : undefined,
      lastMessageAuthor: last?.authorName,
    };
  });

  // Offer a conversation with every other active teammate, even before the first message.
  const existingPartners = new Set(
    visible.filter((c) => c.kind === 'direct').map((c) => c.otherMemberId).filter(Boolean) as string[],
  );
  const placeholders: ConversationSummary[] = members
    .filter((m) => m.active && m.id !== memberId && !existingPartners.has(m.id))
    .map((m) => ({
      id: directChannelId(memberId, m.id),
      kind: 'direct' as const,
      name: '',
      memberIds: [memberId, m.id].sort(),
      createdAt: '',
      updatedAt: '',
      title: m.name,
      otherMemberId: m.id,
      otherRole: m.role,
      unread: 0,
    }));

  return [...visible, ...placeholders].sort((a, b) => {
    // Public channel first, then by most recent activity.
    if (a.kind === 'public') return -1;
    if (b.kind === 'public') return 1;
    return (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '');
  });
}

/** Total unread messages across all conversations (for the nav badge). */
export async function chatUnreadCount(memberId: string) {
  const row = await sqlOne<{ unread: number }>(
    `SELECT count(*)::int AS unread
       FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id
      WHERE m.author_id <> $1 AND NOT ($1 = ANY(m.read_by))
        AND (c.kind = 'public' OR $1 = ANY(c.member_ids))`,
    [memberId],
  );
  return row?.unread ?? 0;
}
