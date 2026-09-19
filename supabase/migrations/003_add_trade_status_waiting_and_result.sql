-- ─── 003_add_trade_status_waiting_and_result.sql ───────────────────────────
-- Safe, additive migration to update trade status check constraint and add result column.

-- 1. Update status CHECK constraint on trades table to allow ('waiting', 'open', 'closed')
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_status_check;
ALTER TABLE trades ADD CONSTRAINT trades_status_check CHECK (status IN ('waiting', 'open', 'closed'));

-- 2. Add result column to trades table with CHECK constraint ('tp', 'sl', 'be', 'none')
-- Defaults to 'none'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trades' AND column_name = 'result'
  ) THEN
    ALTER TABLE trades ADD COLUMN result TEXT NOT NULL DEFAULT 'none' CHECK (result IN ('tp', 'sl', 'be', 'none'));
  END IF;
END $$;
