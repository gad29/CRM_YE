-- Keys that let a program (an AI bot, an automation) use the API without a
-- browser. Each key acts as one team account and gets that account's access.
-- Only a SHA-256 of the key is kept; the key itself is shown once.
CREATE TABLE api_keys (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  -- The start of the key, shown in the list so a key can be recognised.
  prefix       text NOT NULL,
  key_hash     text NOT NULL UNIQUE,
  account_id   text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_write    boolean NOT NULL DEFAULT false,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  last_used_at timestamptz,
  last_used_ip text,
  revoked_at   timestamptz
);

-- What each key did, so the owner can see the bot's work. Kept 60 days.
CREATE TABLE api_key_requests (
  id     bigserial PRIMARY KEY,
  key_id text NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  at     timestamptz NOT NULL DEFAULT now(),
  method text NOT NULL,
  path   text NOT NULL
);
CREATE INDEX api_key_requests_recent ON api_key_requests (at DESC);
