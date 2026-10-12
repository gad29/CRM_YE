'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PUBLIC_CHANNEL_ID, REMINDER_CHANNEL_LABELS, type ChatMessage, type ReminderChannel } from '@/lib/domain';
import { VoiceRecorder } from '@/components/voice-recorder';

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

function fileEmoji(mimeType: string, name: string) {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return '📄';
  if (mimeType.includes('word') || /\.(docx?|rtf)$/i.test(name)) return '📝';
  if (mimeType.includes('sheet') || /\.(xlsx?|csv)$/i.test(name)) return '📊';
  return '📎';
}

function initials(name: string) {
  return (name || '?').trim()[0]?.toUpperCase() ?? '?';
}

function ChatPageInner() {
  const searchParams = useSearchParams();
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
  const [showMobileThread, setShowMobileThread] = useState(false);
  const [notify, setNotify] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderAt, setReminderAt] = useState('');
  const [reminderChannels, setReminderChannels] = useState<ReminderChannel[]>(['email']);

  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const active = useMemo(() => conversations.find((c) => c.id === activeId), [conversations, activeId]);

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

  // Poll for new messages + conversation list; pause while the tab is hidden.
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
        setError(data.error || 'שליחת ההודעה נכשלה');
        return;
      }
      setBody('');
      setPending([]);
      setReminderAt('');
      setReminderOpen(false);
      if (fileRef.current) fileRef.current.value = '';
      await loadMessages(activeId);
      loadConversations();
    } catch {
      setError('שגיאת תקשורת');
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
    setActiveId(id);
    setShowMobileThread(true);
    setMessages([]);
  }

  const totalUnread = conversations.reduce((sum, c) => sum + c.unread, 0);

  return (
    <div>
      <div className="hero" style={{ marginBottom: 14 }}>
        <div>
          <p className="eyebrow">תקשורת</p>
          <h1 style={{ margin: '6px 0 4px' }}>צ׳אט צוות</h1>
          <p className="muted" style={{ margin: 0 }}>
            הודעות פרטיות וקבוצתיות, קבצים, הקלטות קוליות ותזכורות — הכל במקום אחד.
            {totalUnread > 0 && <strong> · {totalUnread} הודעות חדשות</strong>}
          </p>
        </div>
      </div>

      <div className={`chat-shell ${showMobileThread ? 'show-thread' : ''}`}>
        {/* Conversation list */}
        <aside className="chat-list">
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`chat-list-item ${c.id === activeId ? 'active' : ''}`}
              onClick={() => openConversation(c.id)}
            >
              <span className={`avatar avatar-sm ${c.kind === 'public' ? '' : 'avatar-soft'}`}>
                {c.kind === 'public' ? '#' : initials(c.title)}
              </span>
              <span className="chat-list-meta">
                <span className="chat-list-title">
                  {c.title}
                  {c.otherRole === 'admin' && c.kind === 'direct' && <span className="kind-badge">מנהל</span>}
                </span>
                <span className="chat-list-preview">
                  {c.lastMessagePreview
                    ? `${c.lastMessageAuthor ? `${c.lastMessageAuthor}: ` : ''}${c.lastMessagePreview}`
                    : 'אין הודעות עדיין'}
                </span>
              </span>
              {c.unread > 0 && <span className="chat-unread">{c.unread}</span>}
            </button>
          ))}
          {conversations.length === 0 && <p className="muted" style={{ padding: 12, fontSize: 13 }}>אין שיחות.</p>}
        </aside>

        {/* Thread */}
        <section className="chat-thread">
          <header className="chat-thread-header">
            <button type="button" className="chat-back" onClick={() => setShowMobileThread(false)} aria-label="חזרה לרשימה">
              →
            </button>
            <span className={`avatar avatar-sm ${active?.kind === 'public' ? '' : 'avatar-soft'}`}>
              {active?.kind === 'public' ? '#' : initials(active?.title || '')}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{active?.title || 'שיחה'}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {active?.kind === 'public' ? `ערוץ צוות · ${members.length} חברים` : 'שיחה פרטית'}
              </div>
            </div>
          </header>

          <div className="chat-messages" ref={listRef}>
            {loading && <p className="muted" style={{ textAlign: 'center', fontSize: 13 }}>טוען…</p>}
            {!loading && messages.length === 0 && (
              <p className="muted" style={{ textAlign: 'center', fontSize: 13, marginTop: 20 }}>
                אין עדיין הודעות בשיחה זו — כתוב את ההודעה הראשונה.
              </p>
            )}
            {messages.map((message, index) => {
              const mine = message.authorId === me;
              const previous = messages[index - 1];
              const showDay = !previous || dayOf(previous.createdAt) !== dayOf(message.createdAt);
              return (
                <div key={message.id}>
                  {showDay && <div className="chat-day">{dayOf(message.createdAt)}</div>}
                  <div className={`chat-bubble-row ${mine ? 'mine' : ''}`}>
                    {!mine && <span className="avatar avatar-sm avatar-soft">{initials(message.authorName)}</span>}
                    <div className={`chat-bubble ${mine ? 'mine' : ''} ${message.deletedAt ? 'deleted' : ''}`}>
                      {!mine && active?.kind === 'public' && (
                        <div className="chat-author">{message.authorName}</div>
                      )}
                      {message.deletedAt ? (
                        <div className="muted" style={{ fontSize: 13, fontStyle: 'italic' }}>ההודעה נמחקה</div>
                      ) : (
                        <>
                          {message.body && <div className="chat-text">{message.body}</div>}
                          {message.attachments.map((a) => {
                            const src = `/api/chat/files/${message.id}/${a.id}`;
                            if (a.kind === 'voice') {
                              return (
                                <div key={a.id} className="chat-voice">
                                  <audio controls src={src} />
                                  {a.durationSec ? <span className="muted" style={{ fontSize: 11 }}>{a.durationSec} שנ׳</span> : null}
                                </div>
                              );
                            }
                            if (a.kind === 'image') {
                              return (
                                <a key={a.id} href={src} target="_blank" rel="noreferrer" className="chat-image">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={src} alt={a.originalName} />
                                </a>
                              );
                            }
                            return (
                              <a key={a.id} href={`${src}?download=1`} className="chat-file">
                                <span>{fileEmoji(a.mimeType, a.originalName)}</span>
                                <span className="chat-file-name">{a.originalName}</span>
                                <span className="muted" style={{ fontSize: 11 }}>
                                  {a.size > 1024 * 1024 ? `${(a.size / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(a.size / 1024))}KB`}
                                </span>
                              </a>
                            );
                          })}
                          {message.reminderAt && (
                            <div className="chat-reminder">
                              ⏰ תזכורת ל-{new Date(message.reminderAt).toLocaleString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                              {message.reminderChannels?.length
                                ? ` · ${message.reminderChannels.map((c) => REMINDER_CHANNEL_LABELS[c]).join(', ')}`
                                : ''}
                            </div>
                          )}
                        </>
                      )}
                      <div className="chat-time">
                        {timeOf(message.createdAt)}
                        {!message.deletedAt && (
                          <button type="button" className="chat-delete" onClick={() => removeMessage(message.id)} title="מחק">
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Composer */}
          <div className="chat-composer">
            {pending.length > 0 && (
              <div className="chat-pending">
                {pending.map((file, index) => (
                  <span key={`${file.name}-${index}`} className="doc-file-chip">
                    {fileEmoji(file.type, file.name)} {file.name}
                    <button
                      type="button"
                      onClick={() => setPending((prev) => prev.filter((_, i) => i !== index))}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit' }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}

            {reminderOpen && (
              <div className="chat-reminder-box">
                <span className="muted" style={{ fontSize: 12 }}>תזכורת:</span>
                <input
                  type="datetime-local"
                  value={reminderAt}
                  onChange={(e) => setReminderAt(e.target.value)}
                  style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text)' }}
                />
                {(Object.entries(REMINDER_CHANNEL_LABELS) as [ReminderChannel, string][]).map(([value, label]) => (
                  <label key={value} className={`choice-card ${reminderChannels.includes(value) ? 'selected' : ''}`} style={{ padding: '6px 10px', fontSize: 12 }}>
                    <input type="checkbox" checked={reminderChannels.includes(value)} onChange={() => toggleReminderChannel(value)} />
                    <span>{value === 'email' ? '📧' : '💬'} {label}</span>
                  </label>
                ))}
                <button type="button" className="doc-action-btn" onClick={() => { setReminderOpen(false); setReminderAt(''); }}>בטל</button>
              </div>
            )}

            <div className="chat-composer-row">
              <input
                ref={fileRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files) setPending((prev) => [...prev, ...Array.from(e.target.files as FileList)]);
                }}
              />
              <button type="button" className="composer-btn" onClick={() => fileRef.current?.click()} title="צירוף קבצים">📎</button>
              <VoiceRecorder disabled={sending} onRecorded={(blob, duration) => void send({ blob, duration })} />
              <button
                type="button"
                className={`composer-btn ${reminderOpen ? 'active' : ''}`}
                onClick={() => setReminderOpen((v) => !v)}
                title="הוספת תזכורת"
              >
                ⏰
              </button>
              <button
                type="button"
                className={`composer-btn ${notify ? 'active' : ''}`}
                onClick={() => setNotify((v) => !v)}
                title="שליחת התראה במייל/וואטסאפ על ההודעה"
              >
                🔔
              </button>
              <textarea
                className="chat-input"
                rows={1}
                placeholder="כתוב הודעה…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <button
                type="button"
                className="button button-compact"
                disabled={sending || (!body.trim() && pending.length === 0)}
                onClick={() => void send()}
              >
                {sending ? '…' : 'שלח'}
              </button>
            </div>
            {error && <p className="form-error" style={{ margin: '6px 0 0' }}>{error}</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense>
      <ChatPageInner />
    </Suspense>
  );
}
