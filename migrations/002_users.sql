-- One table for everyone who signs in, with a role.
--
-- Before: the main admin lived only in .env (password-only sign-in), extra
-- admins in `admins`, workers in `workers`. Now every person — including the
-- owner — is a row here and signs in with email + password.
--
-- Ids are kept exactly (ADM-x, WRK-x; the owner is 'admin'), so case
-- handlers, task assignees and chat authors keep pointing at the same people.
-- The owner row itself is created on first start from ADMIN_EMAIL /
-- ADMIN_PASSWORD (scripts/db-migrate.mjs), because SQL cannot read .env.

CREATE TABLE users (
  id                   text PRIMARY KEY,
  name                 text NOT NULL,
  email                text NOT NULL,
  phone                text,
  role                 text NOT NULL CHECK (role IN ('owner', 'admin', 'worker')),
  password_hash        text NOT NULL,
  active               boolean NOT NULL DEFAULT true,
  -- Set when an admin issues a temporary password; cleared on change.
  must_change_password boolean NOT NULL DEFAULT false,
  last_login_at        timestamptz,
  created_at           timestamptz NOT NULL,
  updated_at           timestamptz NOT NULL
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
-- Exactly one owner can exist.
CREATE UNIQUE INDEX users_single_owner ON users (role) WHERE role = 'owner';

-- A clash between an admin's and a worker's email aborts the whole migration
-- (nothing changes) instead of silently dropping someone.
INSERT INTO users (id, name, email, phone, role, password_hash, active, created_at, updated_at)
  SELECT id, name, email, phone, 'admin', password_hash, active, created_at, updated_at FROM admins;
INSERT INTO users (id, name, email, phone, role, password_hash, active, created_at, updated_at)
  SELECT id, name, email, phone, 'worker', password_hash, active, created_at, updated_at FROM workers;

-- Kept (renamed) for reference and rollback; nothing reads them any more.
ALTER TABLE admins RENAME TO legacy_admins;
ALTER TABLE workers RENAME TO legacy_workers;

-- Every sign-in attempt, successful or not — the admin's login history.
CREATE TABLE login_events (
  id         bigserial PRIMARY KEY,
  user_id    text,
  email      text NOT NULL,
  success    boolean NOT NULL,
  reason     text,
  ip         text,
  user_agent text,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_events_at_idx ON login_events (at DESC);
CREATE INDEX login_events_user_idx ON login_events (user_id, at DESC);
