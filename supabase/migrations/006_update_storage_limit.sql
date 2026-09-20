-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: 006_update_storage_limit.sql
-- Description: Update trade-screenshots bucket limit to 40 MB and ensure RLS policies
-- ═══════════════════════════════════════════════════════════════════════════

-- Ensure bucket exists and has 40 MB size limit (40 * 1024 * 1024 = 41943040 bytes)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'trade-screenshots',
  'trade-screenshots',
  false,
  41943040,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 41943040,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];

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

-- Storage Delete Policy: Members can delete screenshots in their workspace
DROP POLICY IF EXISTS "Members can delete screenshots" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own screenshots" ON storage.objects;
CREATE POLICY "Members can delete screenshots"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'trade-screenshots'
    AND public.is_member_of(((storage.foldername(name))[1])::uuid)
  );
