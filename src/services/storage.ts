import { supabase } from './supabase';

export interface UploadResult {
  path: string | null;
  error: string | null;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

/**
 * Upload a screenshot to Supabase Storage.
 * Path: {workspaceId}/{tradeId}/{type}.{ext}
 */
export async function uploadScreenshot(
  file: File,
  workspaceId: string,
  tradeId: string,
  type: 'before' | 'after'
): Promise<UploadResult> {
  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return { path: null, error: 'ขนาดไฟล์เกิน 5 MB (File size exceeds 5MB)' };
  }

  // Validate mime type
  if (!ALLOWED_TYPES.includes(file.type.toLowerCase())) {
    return { path: null, error: 'รองรับเฉพาะไฟล์ PNG, JPEG, JPG หรือ WebP เท่านั้น' };
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
  const path = `${workspaceId}/${tradeId}/${type}.${ext}`;

  const { error } = await supabase.storage
    .from('trade-screenshots')
    .upload(path, file, { upsert: true });

  if (error) {
    console.error('Screenshot upload error:', error);
    return { path: null, error: error.message };
  }

  return { path, error: null };
}

/**
 * Get a signed URL for a screenshot (valid 1 hour).
 */
export async function getScreenshotUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('trade-screenshots')
    .createSignedUrl(path, 3600);

  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Delete a screenshot from storage.
 */
export async function deleteScreenshot(path: string): Promise<boolean> {
  const { error } = await supabase.storage
    .from('trade-screenshots')
    .remove([path]);
  return !error;
}
