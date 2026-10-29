-- Reminders that watch the data they are about: a missing document, a case's
-- missing documents, a client's missing details, an unpaid fee. When the gap
-- is filled the reminder closes itself (resolved_reason says why).
ALTER TABLE tasks
  ADD COLUMN watch_kind text,
  ADD COLUMN watch_ref text,
  ADD COLUMN resolved_reason text;

CREATE INDEX tasks_open_watch_idx ON tasks (watch_kind) WHERE status = 'open' AND watch_kind IS NOT NULL;
