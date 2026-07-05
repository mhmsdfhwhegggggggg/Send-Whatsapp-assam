-- AlMossah Production Migration v3 — PRODUCTION HARDENED
-- Run BEFORE deploying new code (v2 → v3).
-- Safe to re-run (all statements use IF NOT EXISTS / IF EXISTS guards).

-- ── v2 columns (backwards-compat) ────────────────────────────────────────
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS warm_up_day    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_replies  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_sent     INTEGER NOT NULL DEFAULT 0;

ALTER TABLE students ADD COLUMN IF NOT EXISTS city TEXT;

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS kill_switch              BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS new_account_daily_limit  INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS warm_account_daily_limit INTEGER NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS hot_account_daily_limit  INTEGER NOT NULL DEFAULT 150,
  ADD COLUMN IF NOT EXISTS warm_up_days_threshold   INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS hot_days_threshold       INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS hot_reply_threshold      INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS dedup_window_days        INTEGER NOT NULL DEFAULT 7;

-- ── v3 NEW columns ────────────────────────────────────────────────────────

-- Persistent health score on accounts (was in-memory only before)
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS health_score    INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMP;

-- Phone verification tracking on messages
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE;

-- New settings for v3 features
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS phone_validation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS health_score_threshold   INTEGER NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS cooldown_hours           INTEGER NOT NULL DEFAULT 24;

-- ── v3 NEW ENUM types ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE account_event_type AS ENUM (
    'connected','disconnected','qr_requested','logged_out',
    'send_ok','send_fail','health_warning','suspended'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE proxy_type AS ENUM ('residential','mobile','datacenter');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── v3 NEW TABLES ─────────────────────────────────────────────────────────

-- Proxy pool: one residential proxy per WhatsApp account
CREATE TABLE IF NOT EXISTS proxies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url          TEXT NOT NULL UNIQUE,
  type         proxy_type NOT NULL DEFAULT 'residential',
  country      TEXT,
  is_healthy   BOOLEAN NOT NULL DEFAULT TRUE,
  fail_count   INTEGER NOT NULL DEFAULT 0,
  last_checked TIMESTAMP,
  assigned_to  UUID,           -- accountsTable.id (1-to-1 assignment)
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proxies_healthy ON proxies(is_healthy);
CREATE INDEX IF NOT EXISTS idx_proxies_assigned ON proxies(assigned_to);

-- Account events: persistent audit trail replacing in-memory health tracking
CREATE TABLE IF NOT EXISTS account_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_type  account_event_type NOT NULL,
  detail      TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_acct_events_account   ON account_events(account_id);
CREATE INDEX IF NOT EXISTS idx_acct_events_type      ON account_events(event_type);
CREATE INDEX IF NOT EXISTS idx_acct_events_created   ON account_events(created_at);
-- Efficient early-warning query: disconnects in past 2h per account
CREATE INDEX IF NOT EXISTS idx_acct_events_warn ON account_events(account_id, event_type, created_at)
  WHERE event_type IN ('disconnected', 'health_warning', 'suspended');

-- ── v2 tables (if not already present) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS opt_out (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL UNIQUE,
  keyword     TEXT,
  added_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  campaign_id UUID,
  account_id  UUID
);
CREATE INDEX IF NOT EXISTS idx_opt_out_phone ON opt_out(phone);

CREATE TABLE IF NOT EXISTS inbound_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL,
  account_id  UUID,
  body        TEXT NOT NULL,
  is_stop_word BOOLEAN NOT NULL DEFAULT FALSE,
  received_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inbound_phone    ON inbound_messages(phone);
CREATE INDEX IF NOT EXISTS idx_inbound_account  ON inbound_messages(account_id);
CREATE INDEX IF NOT EXISTS idx_inbound_received ON inbound_messages(received_at);

CREATE INDEX IF NOT EXISTS idx_messages_dedup ON messages(phone, status, sent_at) WHERE status = 'sent';

-- ── Enforce safe defaults on existing campaigns ───────────────────────────
UPDATE campaigns SET min_delay_sec   = 30  WHERE min_delay_sec < 30;
UPDATE campaigns SET max_delay_sec   = 90  WHERE max_delay_sec < 30;
UPDATE campaigns SET batch_size      = 20  WHERE batch_size > 50;
UPDATE campaigns SET batch_pause_min = 10  WHERE batch_pause_min < 5;
UPDATE settings  SET daily_limit_per_account = 80 WHERE daily_limit_per_account > 200;

-- Initialise health score for existing accounts
UPDATE accounts SET health_score = 100 WHERE health_score IS NULL OR health_score = 0;

-- ── Verify migration ──────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
