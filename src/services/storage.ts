import { supabase } from './supabase';

export interface UploadResult {
  path: string | null;
  error: string | null;
}

export const MAX_SCREENSHOT_FILE_SIZE = 40 * 1024 * 1024; // 40MB
export const ALLOWED_SCREENSHOT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
];

export const ALLOWED_SCREENSHOT_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif'];

/**
 * Validate a screenshot file before upload.
 */
export function validateScreenshotFile(file: File): { valid: boolean; error: string | null } {
  if (file.size > MAX_SCREENSHOT_FILE_SIZE) {
    return { valid: false, error: 'ขนาดไฟล์เกิน 40 MB กรุณาเลือกไฟล์ที่มีขนาดไม่เกิน 40 MB' };
  }

  const type = file.type.toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase();
  const isTypeValid = ALLOWED_SCREENSHOT_TYPES.includes(type) ||
    (ext && ALLOWED_SCREENSHOT_EXTENSIONS.includes(ext)) ||
    type.startsWith('image/');

  if (!isTypeValid) {
    return { valid: false, error: 'รองรับเฉพาะไฟล์รูปภาพ (PNG, JPEG, JPG, WebP, GIF, HEIC/HEIF) เท่านั้น' };
  }

  return { valid: true, error: null };
}

/**
 * Automatically compress and fit any image to optimized web dimensions & size.
 * Targets < 1.5MB (typically 200KB - 800KB) so it never exceeds Supabase storage limits.
 */
export async function compressAndFitImage(
  file: File,
  maxDimension = 2048,
  initialQuality = 0.82
): Promise<File> {
  // If SVG, return as is
  if (file.type === 'image/svg+xml') {
    return file;
  }

  return new Promise((resolve) => {
    // If not in browser environment, return original
    if (typeof window === 'undefined') {
      resolve(file);
      return;
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;

      // Scale dimensions
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        resolve(file);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Always output standard web JPEG for photos/charts unless small PNG
      const isPngSmall = file.type === 'image/png' && file.size < 1.5 * 1024 * 1024;
      const outputType = isPngSmall ? 'image/png' : 'image/jpeg';
      const outputQuality = isPngSmall ? undefined : initialQuality;

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }

          // If blob is still > 2MB, downscale further
          if (blob.size > 2 * 1024 * 1024 && width > 1200) {
            const smallCanvas = document.createElement('canvas');
            smallCanvas.width = Math.round(width * 0.7);
            smallCanvas.height = Math.round(height * 0.7);
            const smallCtx = smallCanvas.getContext('2d');
            if (smallCtx) {
              smallCtx.drawImage(canvas, 0, 0, smallCanvas.width, smallCanvas.height);
              smallCanvas.toBlob(
                (secondBlob) => {
                  if (secondBlob) {
                    const newFileName = file.name.replace(/\.[^/.]+$/, '') + '.jpg';
                    resolve(new File([secondBlob], newFileName, { type: 'image/jpeg', lastModified: Date.now() }));
                  } else {
                    resolve(new File([blob], file.name.replace(/\.[^/.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
                  }
                },
                'image/jpeg',
                0.75
              );
              return;
            }
          }

          const ext = outputType === 'image/png' ? '.png' : '.jpg';
          const newFileName = file.name.replace(/\.[^/.]+$/, '') + ext;
          const fittedFile = new File([blob], newFileName, {
            type: outputType,
            lastModified: Date.now(),
          });
          resolve(fittedFile);
        },
        outputType,
        outputQuality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}

/**
 * Upload a screenshot to Supabase Storage with auto-fit compression.
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

  // Auto-compress and fit any image resolution/file size to fast web standard
  let processedFile = file;
  try {
    processedFile = await compressAndFitImage(file);
  } catch (err) {
    console.warn('Image auto-compression skipped, uploading original:', err);
  }

  const ext = processedFile.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const path = `${workspaceId}/${tradeId}/${type}.${ext}`;

  try {
    const { error } = await supabase.storage
      .from('trade-screenshots')
      .upload(path, processedFile, { upsert: true, contentType: processedFile.type });

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
