-- ═══════════════════════════════════════════════════════════════════════════
-- TradeTogether — Initial Schema
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Helper: generate random invite code (8 chars, alphanumeric) ────────
CREATE OR REPLACE FUNCTION generate_invite_code()
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLES
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── profiles ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL DEFAULT '',
  avatar_url    TEXT,
  preferred_currency TEXT NOT NULL DEFAULT 'THB'
    CHECK (preferred_currency IN ('USD', 'THB', 'EUR')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── workspaces ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  invite_code TEXT UNIQUE DEFAULT generate_invite_code(),
  created_by  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── workspace_members ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'member')),
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

-- ─── strategies ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS strategies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── trades ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trades (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  asset             TEXT NOT NULL,
  market            TEXT,
  direction         TEXT NOT NULL CHECK (direction IN ('long', 'short')),
  status            TEXT NOT NULL DEFAULT 'closed' CHECK (status IN ('open', 'closed')),
  trade_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  strategy_id       UUID REFERENCES strategies(id) ON DELETE SET NULL,
  entry_price       NUMERIC,
  exit_price        NUMERIC,
  stop_loss         NUMERIC,
  take_profit       NUMERIC,
  position_size     NUMERIC,
  leverage          NUMERIC,
  fees              NUMERIC DEFAULT 0,
  session           TEXT,
  entry_reason      TEXT,
  exit_reason       TEXT,
  emotion           TEXT CHECK (emotion IN (
    'calm', 'confident', 'nervous', 'fear', 'fomo', 'angry', 'tired', 'excited'
  )),
  confidence        INTEGER CHECK (confidence IS NULL OR (confidence >= 1 AND confidence <= 10)),
  followed_plan     BOOLEAN,
  review            TEXT,
  screenshot_before TEXT,
  screenshot_after  TEXT,
  visibility        TEXT NOT NULL DEFAULT 'shared' CHECK (visibility IN ('private', 'shared')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── journal_entries ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL DEFAULT '',
  entry_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_workspace_members_user    ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_ws      ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_trades_workspace          ON trades(workspace_id);
CREATE INDEX IF NOT EXISTS idx_trades_user               ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_date               ON trades(trade_date);
CREATE INDEX IF NOT EXISTS idx_trades_strategy           ON trades(strategy_id);
CREATE INDEX IF NOT EXISTS idx_journal_workspace         ON journal_entries(workspace_id);
CREATE INDEX IF NOT EXISTS idx_journal_user              ON journal_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_journal_date              ON journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_strategies_workspace      ON strategies(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_invite_code    ON workspaces(invite_code);

-- ═══════════════════════════════════════════════════════════════════════════
-- TRIGGERS: auto-update updated_at
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_workspaces_updated_at ON workspaces;
CREATE TRIGGER trg_workspaces_updated_at
  BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_strategies_updated_at ON strategies;
CREATE TRIGGER trg_strategies_updated_at
  BEFORE UPDATE ON strategies FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_trades_updated_at ON trades;
CREATE TRIGGER trg_trades_updated_at
  BEFORE UPDATE ON trades FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_journal_updated_at ON journal_entries;
CREATE TRIGGER trg_journal_updated_at
  BEFORE UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- TRIGGER: auto-create profile on signup
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', '')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: join_workspace_by_invite_code
-- Validates code, creates membership atomically. No workspace/code exposure.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION join_workspace_by_invite_code(code TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ws_id UUID;
  ws_name TEXT;
  existing UUID;
  member_count INT;
BEGIN
  -- Find workspace by invite code
  SELECT id, name INTO ws_id, ws_name
  FROM public.workspaces
  WHERE invite_code = upper(trim(code));

  IF ws_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Invalid invite code');
  END IF;

  -- Check if already a member
  SELECT id INTO existing
  FROM public.workspace_members
  WHERE workspace_id = ws_id AND user_id = auth.uid();

  IF existing IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', 'Already a member of this workspace');
  END IF;

  -- Check member count (max 2 for now)
  SELECT count(*) INTO member_count
  FROM public.workspace_members
  WHERE workspace_id = ws_id;

  IF member_count >= 2 THEN
    RETURN json_build_object('success', false, 'error', 'Workspace is full');
  END IF;

  -- Create membership
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (ws_id, auth.uid(), 'member');

  RETURN json_build_object(
    'success', true,
    'workspace_id', ws_id,
    'workspace_name', ws_name
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: regenerate_invite_code (owner only)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION regenerate_invite_code(ws_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_code TEXT;
BEGIN
  -- Verify caller is owner
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id
      AND user_id = auth.uid()
      AND role = 'owner'
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;

  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  UPDATE public.workspaces
  SET invite_code = new_code
  WHERE id = ws_id;

  RETURN json_build_object('success', true, 'invite_code', new_code);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: revoke_invite_code (owner only)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION revoke_invite_code(ws_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id
      AND user_id = auth.uid()
      AND role = 'owner'
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;

  UPDATE public.workspaces
  SET invite_code = NULL
  WHERE id = ws_id;

  RETURN json_build_object('success', true);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: create_workspace (atomic workspace + owner membership creation)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_workspace(name TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_ws_id UUID;
  new_invite_code TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  new_invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  INSERT INTO workspaces (name, created_by, invite_code)
  VALUES (name, auth.uid(), new_invite_code)
  RETURNING id INTO new_ws_id;

  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (new_ws_id, auth.uid(), 'owner');

  RETURN json_build_object(
    'success', true,
    'workspace_id', new_ws_id,
    'invite_code', new_invite_code
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY HELPERS (SECURITY DEFINER with PLPGSQL to prevent RLS recursion)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION is_member_of(_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = _workspace_id
      AND user_id = auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION is_owner_of(_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = _workspace_id
      AND user_id = auth.uid()
      AND role = 'owner'
  );
END;
$$;

CREATE OR REPLACE FUNCTION shares_workspace_with(_target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM workspace_members wm1
    JOIN workspace_members wm2 ON wm1.workspace_id = wm2.workspace_id
    WHERE wm1.user_id = auth.uid()
      AND wm2.user_id = _target_user_id
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY POLICIES
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

-- ─── profiles ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Users can read co-member profiles" ON profiles;
CREATE POLICY "Users can read co-member profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (shares_workspace_with(id));

-- ─── workspaces ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Members can read their workspaces" ON workspaces;
CREATE POLICY "Members can read their workspaces"
  ON workspaces FOR SELECT
  TO authenticated
  USING (created_by = auth.uid() OR is_member_of(id));

DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON workspaces;
CREATE POLICY "Authenticated users can create workspaces"
  ON workspaces FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "Owner can update workspace" ON workspaces;
CREATE POLICY "Owner can update workspace"
  ON workspaces FOR UPDATE
  TO authenticated
  USING (is_owner_of(id));

-- ─── workspace_members ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "Members can see co-members" ON workspace_members;
CREATE POLICY "Members can see co-members"
  ON workspace_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR is_member_of(workspace_id));

DROP POLICY IF EXISTS "Users can create own membership" ON workspace_members;
CREATE POLICY "Users can create own membership"
  ON workspace_members FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Owners or self can remove members" ON workspace_members;
CREATE POLICY "Owners or self can remove members"
  ON workspace_members FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR is_owner_of(workspace_id));

-- ─── strategies ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Members can read workspace strategies" ON strategies;
CREATE POLICY "Members can read workspace strategies"
  ON strategies FOR SELECT
  TO authenticated
  USING (is_member_of(workspace_id));

DROP POLICY IF EXISTS "Members can create strategies" ON strategies;
CREATE POLICY "Members can create strategies"
  ON strategies FOR INSERT
  TO authenticated
  WITH CHECK (is_member_of(workspace_id));

DROP POLICY IF EXISTS "Members can update strategies" ON strategies;
CREATE POLICY "Members can update strategies"
  ON strategies FOR UPDATE
  TO authenticated
  USING (is_member_of(workspace_id));

DROP POLICY IF EXISTS "Members can delete strategies" ON strategies;
CREATE POLICY "Members can delete strategies"
  ON strategies FOR DELETE
  TO authenticated
  USING (is_member_of(workspace_id));

-- ─── trades ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can read own trades" ON trades;
CREATE POLICY "Users can read own trades"
  ON trades FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Co-members can read shared trades" ON trades;
CREATE POLICY "Co-members can read shared trades"
  ON trades FOR SELECT
  TO authenticated
  USING (visibility = 'shared' AND is_member_of(workspace_id));

DROP POLICY IF EXISTS "Users can create own trades" ON trades;
CREATE POLICY "Users can create own trades"
  ON trades FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_member_of(workspace_id));

DROP POLICY IF EXISTS "Users can update own trades" ON trades;
CREATE POLICY "Users can update own trades"
  ON trades FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own trades" ON trades;
CREATE POLICY "Users can delete own trades"
  ON trades FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ─── journal_entries ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Members can read workspace journal" ON journal_entries;
CREATE POLICY "Members can read workspace journal"
  ON journal_entries FOR SELECT
  TO authenticated
  USING (is_member_of(workspace_id));

DROP POLICY IF EXISTS "Members can create journal entries" ON journal_entries;
CREATE POLICY "Members can create journal entries"
  ON journal_entries FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_member_of(workspace_id));

DROP POLICY IF EXISTS "Users can update own journal entries" ON journal_entries;
CREATE POLICY "Users can update own journal entries"
  ON journal_entries FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own journal entries" ON journal_entries;
CREATE POLICY "Users can delete own journal entries"
  ON journal_entries FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- STORAGE: trade-screenshots bucket
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public)
VALUES ('trade-screenshots', 'trade-screenshots', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Members can upload screenshots" ON storage.objects;
CREATE POLICY "Members can upload screenshots"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'trade-screenshots'
    AND is_member_of((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "Members can view screenshots" ON storage.objects;
CREATE POLICY "Members can view screenshots"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'trade-screenshots'
    AND is_member_of((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "Users can delete own screenshots" ON storage.objects;
CREATE POLICY "Users can delete own screenshots"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'trade-screenshots'
    AND owner_id = (auth.uid())::text
  );
