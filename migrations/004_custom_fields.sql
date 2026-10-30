-- Client and case fields added in Settings keep their values here, by field key.
ALTER TABLE clients ADD COLUMN extra jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE cases ADD COLUMN extra jsonb NOT NULL DEFAULT '{}'::jsonb;
