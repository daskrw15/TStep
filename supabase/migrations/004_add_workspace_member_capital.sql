-- ─── 004_add_workspace_member_capital.sql ─────────────────────────────────────
-- Add capital contribution column to workspace_members table

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workspace_members' AND column_name = 'capital'
  ) THEN
    ALTER TABLE workspace_members ADD COLUMN capital NUMERIC NOT NULL DEFAULT 0 CHECK (capital >= 0);
  END IF;
END $$;

-- Allow workspace members to update their own capital (or members within the same workspace)
DROP POLICY IF EXISTS "Members can update their own capital" ON workspace_members;
CREATE POLICY "Members can update their own capital"
  ON workspace_members FOR UPDATE
  TO authenticated
  USING (is_member_of(workspace_id))
  WITH CHECK (is_member_of(workspace_id));
