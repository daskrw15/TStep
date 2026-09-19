import { supabase } from './supabase';

export interface UploadResult {
  path: string | null;
  error: string | null;
}

export const MAX_SCREENSHOT_FILE_SIZE = 40 * 1024 * 1024; // 40MB
export const ALLOWED_SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

/**
 * Validate a screenshot file before upload.
 */
export function validateScreenshotFile(file: File): { valid: boolean; error: string | null } {
  if (file.size > MAX_SCREENSHOT_FILE_SIZE) {
    return { valid: false, error: 'ขนาดไฟล์เกิน 40 MB กรุณาเลือกไฟล์ที่มีขนาดไม่เกิน 40 MB' };
  }

  const type = file.type.toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase();
  const isTypeValid = ALLOWED_SCREENSHOT_TYPES.includes(type) || (ext && ['png', 'jpg', 'jpeg', 'webp'].includes(ext));

  if (!isTypeValid) {
    return { valid: false, error: 'รองรับเฉพาะไฟล์รูปภาพประเภท PNG, JPEG, JPG หรือ WebP เท่านั้น' };
  }

  return { valid: true, error: null };
}

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
  const validation = validateScreenshotFile(file);
  if (!validation.valid) {
    return { path: null, error: validation.error };
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
  const path = `${workspaceId}/${tradeId}/${type}.${ext}`;

  try {
    const { error } = await supabase.storage
      .from('trade-screenshots')
      .upload(path, file, { upsert: true });

    if (error) {
      console.error('Screenshot upload error:', error);
      return { path: null, error: error.message };
    }

    return { path, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Unexpected screenshot upload exception:', err);
    return { path: null, error: msg };
  }
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
