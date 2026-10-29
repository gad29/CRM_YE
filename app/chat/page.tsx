'use client';

import '@/app/styles/tools.css';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PUBLIC_CHANNEL_ID, REMINDER_CHANNEL_LABELS, type ChatMessage, type ReminderChannel } from '@/lib/domain';
import { VoiceRecorder } from '@/components/voice-recorder';
import { useSession } from '@/components/session-provider';
import { PageHead, initials } from '@/components/ui/bits';
import { IconArrowRight, IconBell, IconClock, IconDownload, IconFile, IconImage, IconSend, IconTrash, IconX } from '@/components/ui/icons';

type Conversation = {
  id: string;
  kind: 'public' | 'direct';
  title: string;
  otherMemberId?: string;
  otherRole?: 'admin' | 'worker';
  unread: number;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  lastMessageAuthor?: string;
};

type Member = { id: string; name: string; role: 'admin' | 'worker'; email?: string; phone?: string };

const POLL_MS = 4000;

const IconPaperclip = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

function dayOf(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (date.toDateString() === today.toDateString()) return 'היום';
  if (date.toDateString() === yesterday.toDateString()) return 'אתמול';
  return date.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Short "when" for the conversation list: time today, else the date. */
function whenOf(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? timeOf(iso)
    : d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
}

function sizeOf(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function ChatPageInner() {
  const searchParams = useSearchParams();
  const { me: viewer } = useSession();
  const [me, setMe] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [activeId, setActiveId] = useState<string>(searchParams.get('channel') || PUBLIC_CHANNEL_ID);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [pending, setPending] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [showThread, setShowThread] = useState(Boolean(searchParams.get('channel')));
  const [notify, setNotify] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderAt, setReminderAt] = useState('');
  const [reminderChannels, setReminderChannels] = useState<ReminderChannel[]>(['email']);

  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const active = useMemo(() => conversations.find((c) => c.id === activeId), [conversations, activeId]);
  const publicChannels = conversations.filter((c) => c.kind === 'public');
  const directs = conversations.filter((c) => c.kind === 'direct');

  const loadConversations = useCallback(async () => {
    try {
      const data = await fetch('/api/chat/channels').then((r) => r.json());
      if (data.ok) {
        setMe(data.data.me);
        setConversations(data.data.conversations);
        setMembers(data.data.members);
      }
    } catch {
      /* offline — the next poll retries */
    }
  }, []);

  const loadMessages = useCallback(async (channelId: string) => {
    try {
      const data = await fetch(`/api/chat/messages?channelId=${encodeURIComponent(channelId)}`).then((r) => r.json());
      if (data.ok) {
        setMessages(data.data.messages);
        setMe(data.data.me);
      } else {
        // A conversation that has no messages yet simply starts empty.
        setMessages([]);
      }
    } catch {
      /* keep what we have */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    setLoading(true);
    loadMessages(activeId);
  }, [activeId, loadMessages]);

  // Poll for new messages and the conversation list; pause while the tab is hidden.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadMessages(activeId);
      loadConversations();
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [activeId, loadMessages, loadConversations]);

  // Keep the thread pinned to the newest message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, activeId]);

  // Grow the text box with its content, up to the CSS max-height.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  function toggleReminderChannel(channel: ReminderChannel) {
    setReminderChannels((prev) => (prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]));
  }

  async function send(extraFile?: { blob: Blob; duration: number }) {
    const text = body.trim();
    if (!text && !pending.length && !extraFile) return;
    setSending(true);
    setError('');
    try {
      const useForm = pending.length > 0 || Boolean(extraFile);
      let res: Response;
      if (useForm) {
        const form = new FormData();
        form.append('channelId', activeId);
        if (text) form.append('body', text);
        if (notify) form.append('notify', '1');
        if (reminderAt) {
          form.append('reminderAt', new Date(reminderAt).toISOString());
          form.append('reminderChannels', reminderChannels.join(','));
        }
        if (extraFile) {
          form.append('voice', '1');
          form.append('voiceDuration', String(extraFile.duration));
          form.append('file', new File([extraFile.blob], `voice-${Date.now()}.webm`, { type: extraFile.blob.type || 'audio/webm' }));
        }
        for (const file of pending) form.append('file', file);
        res = await fetch('/api/chat/messages', { method: 'POST', body: form });
      } else {
        res = await fetch('/api/chat/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelId: activeId,
            body: text,
            notify,
            reminderAt: reminderAt ? new Date(reminderAt).toISOString() : undefined,
            reminderChannels,
          }),
        });
      }
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'ההודעה לא נשלחה — נסו שוב');
        return;
      }
      setBody('');
      setPending([]);
      setReminderAt('');
      setReminderOpen(false);
      setNotify(false);
      if (fileRef.current) fileRef.current.value = '';
      await loadMessages(activeId);
      loadConversations();
    } catch {
      setError('אין חיבור לשרת — ההודעה לא נשלחה');
    } finally {
      setSending(false);
    }
  }

  async function removeMessage(messageId: string) {
    if (!window.confirm('למחוק את ההודעה?')) return;
    await fetch(`/api/chat/messages/${messageId}`, { method: 'DELETE' });
    loadMessages(activeId);
    loadConversations();
  }

  function openConversation(id: string) {
    if (id !== activeId) setMessages([]);
    setActiveId(id);
    setShowThread(true);
  }

  const totalUnread = conversations.reduce((sum, c) => sum + c.unread, 0);

  const renderConversation = (c: Conversation) => (
      <button key={c.id} type="button" className={`chat-item ${c.id === activeId ? 'on' : ''}`} onClick={() => openConversation(c.id)}>
        <span className={`avatar ${c.kind === 'public' ? 'channel' : ''}`}>{c.kind === 'public' ? '#' : initials(c.title)}</span>
        <span className="chat-item-text">
          <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <span className="chat-item-name truncate">{c.title}</span>
            {c.kind === 'direct' && c.otherRole === 'admin' && <span className="chip" style={{ height: 19, fontSize: 11 }}>מנהל</span>}
            <span className="spacer" />
            <span className="tiny muted nowrap">{whenOf(c.lastMessageAt)}</span>
          </span>
          <span className="chat-item-last truncate">
            {c.lastMessagePreview ? `${c.lastMessageAuthor ? `${c.lastMessageAuthor}: ` : ''}${c.lastMessagePreview}` : 'עוד אין הודעות'}
          </span>
        </span>
        {c.unread > 0 && <span className="chat-unread">{c.unread}</span>}
      </button>
  );

  const canSend = !sending && (Boolean(body.trim()) || pending.length > 0);

  return (
    <>
      <PageHead
        title="צ׳אט צוות"
        sub={
          <>
            הודעות לצוות ובפרטי, קבצים, הקלטות ותזכורות.
            {totalUnread > 0 && <strong className="ink-2"> {totalUnread} הודעות שלא נקראו.</strong>}
          </>
        }
      />

      <div className={`chat ${showThread ? 'has-open' : ''}`}>
        <aside className="chat-list" aria-label="שיחות">
          {publicChannels.map(renderConversation)}
          {directs.length > 0 && <div className="chat-list-label">שיחות פרטיות</div>}
          {directs.map(renderConversation)}
          {conversations.length === 0 && <p className="muted small" style={{ padding: 12 }}>טוען שיחות…</p>}
        </aside>

        <section className="chat-pane" aria-label={active?.title || 'שיחה'}>
          <header className="chat-pane-head">
            <button type="button" className="icon-button small chat-back" onClick={() => setShowThread(false)} aria-label="חזרה לרשימת השיחות">
              <IconArrowRight size={16} />
            </button>
            <span className={`avatar ${active?.kind === 'public' ? 'channel' : ''}`}>
              {active?.kind === 'public' ? '#' : initials(active?.title || '')}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="strong truncate">{active?.title || 'שיחה'}</div>
              <div className="tiny muted">
                {active?.kind === 'public' ? `כל הצוות · ${members.length} אנשים` : 'רק שניכם רואים את השיחה'}
              </div>
            </div>
          </header>

          <div className="chat-messages">
            {loading && messages.length === 0 && <p className="muted small" style={{ textAlign: 'center' }}>טוען הודעות…</p>}
            {!loading && messages.length === 0 && (
              <div className="empty" style={{ margin: 'auto' }}>
                <div className="empty-title">עוד לא נכתב כאן כלום</div>
                <div className="small">
                  {active?.kind === 'public' ? 'הודעה כאן מגיעה לכל הצוות.' : `כתבו ל${active?.title || 'עמית'} את ההודעה הראשונה.`}
                </div>
              </div>
            )}
            {messages.map((message, index) => {
              const mine = message.authorId === me;
              const previous = messages[index - 1];
              const showDay = !previous || dayOf(previous.createdAt) !== dayOf(message.createdAt);
              const sameAuthor = previous && !showDay && previous.authorId === message.authorId;
              return (
                <div key={message.id} style={{ display: 'contents' }}>
                  {showDay && <div className="chat-day">{dayOf(message.createdAt)}</div>}
                  <div className={`bubble ${mine ? 'mine' : ''} ${message.deletedAt ? 'deleted' : ''}`} style={sameAuthor ? { marginTop: -2 } : undefined}>
                    {!mine && active?.kind === 'public' && !sameAuthor && <div className="bubble-author">{message.authorName}</div>}
                    {message.deletedAt ? (
                      <div className="bubble-body">ההודעה נמחקה</div>
                    ) : (
                      <>
                        {message.body && <div className="bubble-body">{message.body}</div>}
                        {message.attachments.map((a) => {
                          const src = `/api/chat/files/${message.id}/${a.id}`;
                          if (a.kind === 'voice') {
                            return (
                              <div key={a.id} className="row" style={{ gap: 6 }}>
                                <audio controls src={src} preload="none" />
                                {a.durationSec ? <span className="tiny bubble-meta">{a.durationSec} שנ׳</span> : null}
                              </div>
                            );
                          }
                          if (a.kind === 'image') {
                            return (
                              <a key={a.id} href={src} target="_blank" rel="noreferrer" aria-label={`פתיחת התמונה ${a.originalName}`}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={src} alt={a.originalName} loading="lazy" />
                              </a>
                            );
                          }
                          return (
                            <a key={a.id} href={`${src}?download=1`} className="bubble-file">
                              {a.mimeType.startsWith('image/') ? <IconImage size={16} /> : <IconFile size={16} />}
                              <span className="name">{a.originalName}</span>
                              <span className="tiny" style={{ opacity: 0.7 }}>{sizeOf(a.size)}</span>
                              <IconDownload size={15} />
                            </a>
                          );
                        })}
                        {message.reminderAt && (
                          <div className="bubble-reminder">
                            <IconClock size={14} />
                            תזכורת ב-
                            {new Date(message.reminderAt).toLocaleString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            {message.reminderChannels?.length ? ` · ${message.reminderChannels.map((c) => REMINDER_CHANNEL_LABELS[c]).join(', ')}` : ''}
                          </div>
                        )}
                      </>
                    )}
                    <div className="bubble-meta">
                      <span className="num">{timeOf(message.createdAt)}</span>
                      {!message.deletedAt && (mine || viewer?.isAdmin) && (
                        <button type="button" className="bubble-delete" onClick={() => removeMessage(message.id)} aria-label="מחיקת ההודעה">
                          <IconTrash size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          <div className="chat-composer">
            {pending.length > 0 && (
              <div className="composer-pending">
                {pending.map((file, index) => (
                  <span key={`${file.name}-${index}`} className="file-pill">
                    {file.type.startsWith('image/') ? <IconImage size={13} /> : <IconFile size={13} />}
                    <span className="truncate">{file.name}</span>
                    <button type="button" onClick={() => setPending((prev) => prev.filter((_, i) => i !== index))} aria-label={`הסרת ${file.name}`}>
                      <IconX size={13} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {reminderOpen && (
              <div className="composer-reminder">
                <IconClock size={15} />
                <span>תזכורת למקבלים ב-</span>
                <input type="datetime-local" value={reminderAt} onChange={(e) => setReminderAt(e.target.value)} aria-label="מועד התזכורת" />
                {(Object.entries(REMINDER_CHANNEL_LABELS) as [ReminderChannel, string][]).map(([value, label]) => (
                  <label key={value} className="checkbox small">
                    <input type="checkbox" checked={reminderChannels.includes(value)} onChange={() => toggleReminderChannel(value)} />
                    {label}
                  </label>
                ))}
                <span className="spacer" />
                <button type="button" className="button button-quiet button-compact" onClick={() => { setReminderOpen(false); setReminderAt(''); }}>
                  הסרת התזכורת
                </button>
              </div>
            )}

            {notify && (
              <div className="tiny muted row" style={{ gap: 6 }}>
                <IconBell size={13} /> ההודעה תישלח גם במייל או בוואטסאפ למי שבשיחה.
              </div>
            )}

            <div className="chat-composer-row">
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  const files = e.target.files;
                  if (files) setPending((prev) => [...prev, ...Array.from(files)]);
                }}
              />
              <button type="button" className="icon-button composer-btn" onClick={() => fileRef.current?.click()} aria-label="צירוף קבצים" title="צירוף קבצים">
                <IconPaperclip />
              </button>
              <VoiceRecorder disabled={sending} onRecorded={(blob, duration) => void send({ blob, duration })} />
              <button
                type="button"
                className={`icon-button composer-btn ${reminderOpen ? 'on' : ''}`}
                onClick={() => setReminderOpen((v) => !v)}
                aria-pressed={reminderOpen}
                aria-label="הוספת תזכורת"
                title="הוספת תזכורת"
              >
                <IconClock />
              </button>
              <button
                type="button"
                className={`icon-button composer-btn ${notify ? 'on' : ''}`}
                onClick={() => setNotify((v) => !v)}
                aria-pressed={notify}
                aria-label="לשלוח גם התראה במייל או בוואטסאפ"
                title="לשלוח גם התראה במייל או בוואטסאפ"
              >
                <IconBell />
              </button>
              <textarea
                ref={textRef}
                rows={1}
                placeholder="כתבו הודעה…  (Shift+Enter לשורה חדשה)"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                aria-label="הודעה"
              />
              <button type="button" className="button composer-btn" style={{ padding: 0 }} disabled={!canSend} onClick={() => void send()} aria-label="שליחה">
                <IconSend size={17} />
              </button>
            </div>
            {error && <p className="form-error">{error}</p>}
          </div>
        </section>
      </div>
    </>
  );
}

export default function ChatPage() {
  return (
    <Suspense>
      <ChatPageInner />
    </Suspense>
  );
}
