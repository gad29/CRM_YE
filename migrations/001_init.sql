-- CRM_YE initial PostgreSQL schema.
-- Ids keep the original prefixed format (CL-1166, CASE-1167 …) so existing
-- links, n8n workflows and Google Sheets rows stay valid after the move off JSON.
-- Compatible with PostgreSQL 14+.

-- ── Id counters (atomic "next id" per entity) ────────────────────────────────
CREATE TABLE counters (
  key   text PRIMARY KEY,
  value bigint NOT NULL
);

-- ── Key/value documents: runtime config, settings ────────────────────────────
CREATE TABLE app_kv (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── People who sign in ───────────────────────────────────────────────────────
CREATE TABLE admins (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  email         text NOT NULL,
  phone         text,
  password_hash text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL
);
CREATE UNIQUE INDEX admins_email_key ON admins (lower(email));

CREATE TABLE workers (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  email         text NOT NULL,
  phone         text,
  password_hash text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL
);
CREATE UNIQUE INDEX workers_email_key ON workers (lower(email));

-- ── Clients & cases ──────────────────────────────────────────────────────────
CREATE TABLE clients (
  id         text PRIMARY KEY,
  full_name  text NOT NULL,
  id_number  text,
  phone      text NOT NULL DEFAULT '',
  email      text,
  address    text,
  city       text,
  notes      text,
  created_by text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX clients_created_at_idx ON clients (created_at DESC);

CREATE TABLE cases (
  id                      text PRIMARY KEY,
  client_id               text NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  title                   text NOT NULL,
  office                  text NOT NULL,
  office_other            text,
  description             text,
  stage                   text NOT NULL,
  company                 text,
  case_kind               text,
  trouble_flag            boolean,
  trouble_note            text,
  opened_by               text,
  assigned_to             text,
  fee                     numeric(12, 2) NOT NULL DEFAULT 0,
  reference_number        text,
  next_action             text,
  notes                   text,
  decision                text,
  decision_status         text,
  investigation_outcome   text,
  payment_status_override text,
  opened_at               timestamptz NOT NULL,
  submitted_at            timestamptz,
  decision_at             timestamptz,
  closed_at               timestamptz,
  updated_at              timestamptz NOT NULL
);
CREATE INDEX cases_client_idx ON cases (client_id);
CREATE INDEX cases_opened_at_idx ON cases (opened_at DESC);
CREATE INDEX cases_visibility_idx ON cases (opened_by, assigned_to);

-- Required-documents checklist of a case. `position` keeps the display order.
CREATE TABLE case_checklist_items (
  case_id      text NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  code         text NOT NULL,
  position     integer NOT NULL,
  label        text NOT NULL,
  status       text NOT NULL,
  note         text,
  document_ids text[] NOT NULL DEFAULT '{}',
  updated_at   timestamptz NOT NULL,
  PRIMARY KEY (case_id, code)
);

-- ── Documents (files stay on disk; this is their metadata) ──────────────────
CREATE TABLE documents (
  id             text PRIMARY KEY,
  client_id      text NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  case_id        text REFERENCES cases (id) ON DELETE CASCADE,
  file_name      text NOT NULL,
  original_name  text NOT NULL,
  label          text,
  mime_type      text NOT NULL,
  size           bigint NOT NULL,
  uploaded_at    timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  -- No FK: an edited copy outlives the source it was edited from.
  edited_from_id text
);
CREATE INDEX documents_client_idx ON documents (client_id, uploaded_at DESC);
CREATE INDEX documents_case_idx ON documents (case_id);

-- ── Payments ─────────────────────────────────────────────────────────────────
CREATE TABLE payments (
  id         text PRIMARY KEY,
  client_id  text NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  case_id    text REFERENCES cases (id) ON DELETE CASCADE,
  amount     numeric(12, 2) NOT NULL CHECK (amount > 0),
  method     text NOT NULL,
  paid_at    timestamptz NOT NULL,
  note       text,
  created_at timestamptz NOT NULL
);
CREATE INDEX payments_client_idx ON payments (client_id);
CREATE INDEX payments_case_idx ON payments (case_id);

-- ── Tasks & reminders ────────────────────────────────────────────────────────
CREATE TABLE tasks (
  id                text PRIMARY KEY,
  title             text NOT NULL,
  notes             text,
  due_at            timestamptz,
  remind_at         timestamptz,
  reminder_channels text[] NOT NULL DEFAULT '{}',
  reminder_sent_at  timestamptz,
  reminder_attempts integer NOT NULL DEFAULT 0,
  priority          text NOT NULL DEFAULT 'normal',
  assignee_id       text NOT NULL,
  client_id         text REFERENCES clients (id) ON DELETE SET NULL,
  case_id           text REFERENCES cases (id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'open',
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL,
  completed_at      timestamptz
);
CREATE INDEX tasks_due_reminders_idx ON tasks (remind_at)
  WHERE status = 'open' AND reminder_sent_at IS NULL AND remind_at IS NOT NULL;

-- ── Activity log (unbounded — the JSON store kept only the newest 2,000) ────
CREATE TABLE activity (
  id        text PRIMARY KEY,
  type      text NOT NULL,
  -- No FKs: history must survive the deletion of what it describes.
  client_id text,
  case_id   text,
  summary   text NOT NULL,
  at        timestamptz NOT NULL
);
CREATE INDEX activity_at_idx ON activity (at DESC);
CREATE INDEX activity_client_idx ON activity (client_id, at DESC);
CREATE INDEX activity_case_idx ON activity (case_id, at DESC);

-- ── Team chat ────────────────────────────────────────────────────────────────
CREATE TABLE chat_channels (
  id         text PRIMARY KEY,
  kind       text NOT NULL,
  name       text NOT NULL DEFAULT '',
  member_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE chat_messages (
  id                text PRIMARY KEY,
  channel_id        text NOT NULL REFERENCES chat_channels (id) ON DELETE CASCADE,
  author_id         text NOT NULL,
  author_name       text NOT NULL,
  body              text,
  attachments       jsonb NOT NULL DEFAULT '[]',
  reminder_task_id  text,
  reminder_at       timestamptz,
  reminder_channels text[],
  read_by           text[] NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL,
  deleted_at        timestamptz
);
CREATE INDEX chat_messages_channel_idx ON chat_messages (channel_id, created_at);

-- ── Password-reset codes ─────────────────────────────────────────────────────
CREATE TABLE password_resets (
  id           text PRIMARY KEY,
  account_type text NOT NULL,
  account_id   text NOT NULL,
  email        text NOT NULL,
  code_hash    text NOT NULL,
  expires_at   timestamptz NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL
);
CREATE INDEX password_resets_email_idx ON password_resets (email);

-- ── Security: server-side sessions & rate limiting ───────────────────────────
-- The cookie only carries a signed session id; signing out, deactivating a
-- user or changing their password revokes access immediately.
CREATE TABLE sessions (
  id           text PRIMARY KEY,
  scope        text NOT NULL,          -- 'admin' | 'worker'
  account_id   text NOT NULL,          -- 'admin' (root), ADM-x or WRK-x
  email        text,
  name         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip           text,
  user_agent   text,
  -- Root admin only: fingerprint of the .env credential, so changing
  -- ADMIN_PASSWORD / ADMIN_PASSWORD_HASH ends existing root sessions.
  credential_tag text,
  revoked_at   timestamptz
);
CREATE INDEX sessions_account_idx ON sessions (account_id) WHERE revoked_at IS NULL;

CREATE TABLE rate_limits (
  key          text PRIMARY KEY,
  count        integer NOT NULL,
  window_start timestamptz NOT NULL
);

-- ── Outgoing notifications (Resend email / WhatsApp Cloud API / n8n) ────────
CREATE TABLE notification_log (
  id                  bigserial PRIMARY KEY,
  channel             text NOT NULL,   -- email | whatsapp | sms
  provider            text NOT NULL,   -- resend | meta | n8n
  kind                text NOT NULL,   -- reminder | password-reset | documents | chat | task-assigned | test
  recipient           text NOT NULL,
  status              text NOT NULL,   -- sent | failed | delivered | read
  provider_message_id text,
  error               text,
  related_id          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_log_created_idx ON notification_log (created_at DESC);
CREATE INDEX notification_log_provider_msg_idx ON notification_log (provider_message_id);
