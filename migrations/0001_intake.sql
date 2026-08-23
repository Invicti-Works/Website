-- Intake: conversations, briefs, and the spend fuse.
--
-- Applied by hand, NOT by deploy:
--
--   npx wrangler d1 migrations apply invicti-briefs --remote
--
-- Neither `wrangler deploy` nor Workers Builds runs migrations. Code that
-- expects a column an un-migrated database does not have fails at runtime, in
-- front of a visitor, rather than at deploy time. Apply the migration BEFORE
-- pushing the code that needs it. See README, "Notes for whoever works on this
-- next" -- this is the same species of trap as the plain-vars one.

CREATE TABLE IF NOT EXISTS intake_sessions (
  id             TEXT PRIMARY KEY,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  -- open | complete | capped | abandoned
  status         TEXT    NOT NULL DEFAULT 'open',
  turns          INTEGER NOT NULL DEFAULT 0,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  -- HMAC(ip, INTAKE_SALT). Never the raw address: this is for rate limiting,
  -- and a table of visitor IPs is a liability we have no use for.
  ip_hash        TEXT,
  brief_json     TEXT,
  completeness   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS intake_sessions_ip_day
  ON intake_sessions (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS intake_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT    NOT NULL REFERENCES intake_sessions(id),
  seq             INTEGER NOT NULL,
  -- user | assistant
  role            TEXT    NOT NULL,
  content         TEXT    NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS intake_messages_seq
  ON intake_messages (session_id, seq);

CREATE TABLE IF NOT EXISTS briefs (
  id            TEXT PRIMARY KEY,
  session_id    TEXT    NOT NULL REFERENCES intake_sessions(id),
  created_at    INTEGER NOT NULL,
  -- Denormalised out of brief_json so the console can list and search without
  -- parsing every row.
  email         TEXT,
  name          TEXT,
  organization  TEXT,
  headline      TEXT,
  complexity    TEXT,
  brief_json    TEXT    NOT NULL,
  completeness  INTEGER NOT NULL DEFAULT 0,
  emailed_at    INTEGER,
  -- new | queued | building | review | published | declined
  build_state   TEXT    NOT NULL DEFAULT 'new',
  build_ref     TEXT
);

CREATE INDEX IF NOT EXISTS briefs_created ON briefs (created_at DESC);
CREATE INDEX IF NOT EXISTS briefs_state   ON briefs (build_state, created_at DESC);

-- The fuse. One row per UTC day, read before every model call. This is what
-- stops a bad weekend costing two thousand dollars.
CREATE TABLE IF NOT EXISTS ai_usage (
  day            TEXT PRIMARY KEY,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  est_cents      INTEGER NOT NULL DEFAULT 0,
  calls          INTEGER NOT NULL DEFAULT 0
);
