-- ═══════════════════════════════════════════════════════════════════════════
-- TradeTogether — Migration 002: Database Hardening & Security Fixes
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. RESTRICT DIRECT INSERT ON workspace_members ─────────────────────────
-- Direct insertion of workspace_members by standard clients is disallowed.
-- Memberships MUST be created via trusted SECURITY DEFINER functions:
-- - create_workspace(name) -> creates workspace + owner membership atomically
-- - join_workspace_by_invite_code(code) -> validates invite & creates member role
DROP POLICY IF EXISTS "Users can create own membership" ON public.workspace_members;

-- ─── 2. ATOMIC RPC WITH RACE CONDITION LOCK & MAX 2 MEMBERS ENFORCEMENT ─────

CREATE OR REPLACE FUNCTION public.join_workspace_by_invite_code(code TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ws_id UUID;
  ws_name TEXT;
  existing UUID;
  member_count INT;
  caller_id UUID;
BEGIN
  caller_id := auth.uid();

  IF caller_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF code IS NULL OR trim(code) = '' THEN
    RETURN json_build_object('success', false, 'error', 'Invalid invite code');
  END IF;

  -- 1. Find and explicitly ROW-LOCK the workspace to prevent concurrent join races
  SELECT id, name INTO ws_id, ws_name
  FROM public.workspaces
  WHERE invite_code = upper(trim(code))
  FOR UPDATE;

  IF ws_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Invalid invite code');
  END IF;

  -- 2. Check if caller is already a member
  SELECT id INTO existing
  FROM public.workspace_members
  WHERE workspace_id = ws_id AND user_id = caller_id;

  IF existing IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', 'Already a member of this workspace');
  END IF;

  -- 3. Check current member count (strictly max 2 members for TradeTogether)
  SELECT count(*) INTO member_count
  FROM public.workspace_members
  WHERE workspace_id = ws_id;

  IF member_count >= 2 THEN
    RETURN json_build_object('success', false, 'error', 'Workspace is full');
  END IF;

  -- 4. Ensure caller profile exists (in case trigger was not installed or delayed)
  INSERT INTO public.profiles (id, display_name)
  VALUES (caller_id, '')
  ON CONFLICT (id) DO NOTHING;

  -- 5. Atomically insert new member
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (ws_id, caller_id, 'member');

  RETURN json_build_object(
    'success', true,
    'workspace_id', ws_id,
    'workspace_name', ws_name
  );
END;
$$;

-- ─── 3. HARDEN RPC: create_workspace ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_workspace(name TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_ws_id UUID;
  new_invite_code TEXT;
  caller_id UUID;
  clean_name TEXT;
BEGIN
  caller_id := auth.uid();

  IF caller_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  clean_name := trim(name);
  IF clean_name IS NULL OR clean_name = '' THEN
    RETURN json_build_object('success', false, 'error', 'Workspace name is required');
  END IF;

  -- Ensure caller profile exists (in case trigger was not installed or delayed)
  INSERT INTO public.profiles (id, display_name)
  VALUES (caller_id, '')
  ON CONFLICT (id) DO NOTHING;

  -- Insert workspace
  INSERT INTO public.workspaces (name, created_by, invite_code)
  VALUES (clean_name, caller_id, new_invite_code)
  RETURNING id INTO new_ws_id;

  -- Insert owner membership
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (new_ws_id, caller_id, 'owner');

  RETURN json_build_object(
    'success', true,
    'workspace_id', new_ws_id,
    'invite_code', new_invite_code
  );
END;
$$;

-- ─── 4. HARDEN RPC: regenerate_invite_code & revoke_invite_code ─────────────

CREATE OR REPLACE FUNCTION public.regenerate_invite_code(ws_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_code TEXT;
  caller_id UUID;
BEGIN
  caller_id := auth.uid();

  IF caller_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Verify caller is the owner
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id
      AND user_id = caller_id
      AND role = 'owner'
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;

  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  UPDATE public.workspaces
  SET invite_code = new_code,
      updated_at = now()
  WHERE id = ws_id;

  RETURN json_build_object('success', true, 'invite_code', new_code);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_invite_code(ws_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id UUID;
BEGIN
  caller_id := auth.uid();

  IF caller_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Verify caller is the owner
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id
      AND user_id = caller_id
      AND role = 'owner'
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;

  UPDATE public.workspaces
  SET invite_code = NULL,
      updated_at = now()
  WHERE id = ws_id;

  RETURN json_build_object('success', true);
END;
$$;

-- ─── 5. HARDEN RLS HELPER FUNCTIONS ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_member_of(_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL OR _workspace_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id
      AND user_id = auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_owner_of(_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL OR _workspace_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id
      AND user_id = auth.uid()
      AND role = 'owner'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.shares_workspace_with(_target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL OR _target_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.workspace_members wm1
    JOIN public.workspace_members wm2 ON wm1.workspace_id = wm2.workspace_id
    WHERE wm1.user_id = auth.uid()
      AND wm2.user_id = _target_user_id
  );
END;
$$;

-- ─── 5.1 PERMIT USER TO INSERT OWN PROFILE (Self-healing fallback) ──────────
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- ─── 6. STORAGE: CONFIGURE BUCKET & VERIFY STORAGE POLICIES ─────────────────

-- Create private trade-screenshots bucket with size & mime-type constraints
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'trade-screenshots',
  'trade-screenshots',
  false,
  5242880, -- 5 MB (5 * 1024 * 1024)
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];

-- Storage Upload Policy: Members can only upload to their workspace path
DROP POLICY IF EXISTS "Members can upload screenshots" ON storage.objects;
CREATE POLICY "Members can upload screenshots"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'trade-screenshots'
    AND public.is_member_of(((storage.foldername(name))[1])::uuid)
  );

-- Storage Read Policy: Members can view screenshots in their workspace
DROP POLICY IF EXISTS "Members can view screenshots" ON storage.objects;
CREATE POLICY "Members can view screenshots"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'trade-screenshots'
    AND public.is_member_of(((storage.foldername(name))[1])::uuid)
  );

-- Storage Delete Policy: Users can delete their own screenshots
DROP POLICY IF EXISTS "Users can delete own screenshots" ON storage.objects;
CREATE POLICY "Users can delete own screenshots"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'trade-screenshots'
    AND owner_id = (auth.uid())::text
  );
