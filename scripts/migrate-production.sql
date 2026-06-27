-- AlMossah Production Migration v2
-- Run BEFORE deploying new code.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS warm_up_day   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_replies INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_sent    INTEGER NOT NULL DEFAULT 0;

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

UPDATE campaigns SET min_delay_sec   = 30  WHERE min_delay_sec < 30;
UPDATE campaigns SET max_delay_sec   = 90  WHERE max_delay_sec < 30;
UPDATE campaigns SET batch_size      = 20  WHERE batch_size > 50;
UPDATE campaigns SET batch_pause_min = 10  WHERE batch_pause_min < 5;
UPDATE settings  SET daily_limit_per_account = 80 WHERE daily_limit_per_account > 200;

CREATE TABLE IF NOT EXISTS opt_out (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  keyword TEXT,
  added_at TIMESTAMP NOT NULL DEFAULT NOW(),
  campaign_id UUID,
  account_id UUID
);
CREATE INDEX IF NOT EXISTS idx_opt_out_phone ON opt_out(phone);

CREATE TABLE IF NOT EXISTS inbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  account_id UUID,
  body TEXT NOT NULL,
  is_stop_word BOOLEAN NOT NULL DEFAULT FALSE,
  received_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inbound_phone    ON inbound_messages(phone);
CREATE INDEX IF NOT EXISTS idx_inbound_account  ON inbound_messages(account_id);
CREATE INDEX IF NOT EXISTS idx_inbound_received ON inbound_messages(received_at);

CREATE INDEX IF NOT EXISTS idx_messages_dedup ON messages(phone, status, sent_at) WHERE status = 'sent';

SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
