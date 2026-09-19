-- ─── 005_add_workspace_capital_config.sql ────────────────────────────────────
-- Add user_capital, partner_capital, total_capital, and user/partner ownership percentages
-- to the workspaces table as the default workspace capital configuration.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workspaces' AND column_name = 'user_capital'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN user_capital NUMERIC NOT NULL DEFAULT 0 CHECK (user_capital >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workspaces' AND column_name = 'partner_capital'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN partner_capital NUMERIC NOT NULL DEFAULT 0 CHECK (partner_capital >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workspaces' AND column_name = 'total_capital'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN total_capital NUMERIC NOT NULL DEFAULT 0 CHECK (total_capital >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workspaces' AND column_name = 'user_ownership_pct'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN user_ownership_pct NUMERIC NOT NULL DEFAULT 50 CHECK (user_ownership_pct >= 0 AND user_ownership_pct <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workspaces' AND column_name = 'partner_ownership_pct'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN partner_ownership_pct NUMERIC NOT NULL DEFAULT 50 CHECK (partner_ownership_pct >= 0 AND partner_ownership_pct <= 100);
  END IF;
END $$;

-- Allow members (both owner and partner) to update workspace settings/capital
DROP POLICY IF EXISTS "Members can update workspace capital" ON workspaces;
CREATE POLICY "Members can update workspace capital"
  ON workspaces FOR UPDATE
  TO authenticated
  USING (is_member_of(id))
  WITH CHECK (is_member_of(id));
