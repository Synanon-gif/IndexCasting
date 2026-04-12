/**
 * Client Gallery Upload Service — Phase 2D
 *
 * Owner-only gallery image upload and deletion for client organizations.
 *
 * Storage bucket : organization-profiles (public bucket; URL only surfaced via
 *                  RLS-protected organization_profile_media rows)
 * Storage path   : {organizationId}/client-gallery/{timestamp}-{sanitized}.{ext}
 *
 * Upload technical parity (upload-consent-matrix.mdc):
 *   1. HEIC/HEIF → convert to JPEG via convertHeicToJpegWithStatus; abort on failure
 *   2. validateFile — image-only MIME allowlist (no PDF)
 *   3. checkMagicBytes — byte-level MIME verification
 *   4. checkExtensionConsistency — extension vs MIME (File only)
 *   5. sanitizeUploadBaseName — safe filename
 *   6. storage.upload with upsert:false + explicit contentType
 *   7. On DB failure: storage file cleaned up to avoid orphans
 */

import { supabase } from '../../lib/supabase';
import {
  ALLOWED_MIME_TYPES,
  validateFile,
  checkMagicBytes,
  checkExtensionConsistency,
  sanitizeUploadBaseName,
} from '../../lib/validation';
import { convertHeicToJpegWithStatus } from './imageUtils';
import { assertOrgContext } from '../utils/orgGuard';
import {
  createOrganizationProfileMedia,
  deleteOrganizationProfileMedia,
  getNextClientGallerySortOrder,
  type OrganizationProfileMedia,
} from './organizationProfilesSupabase';

// ─── Constants ─────────────────────────────────────────────────────────────

const GALLERY_BUCKET = 'organization-profiles';
const GALLERY_SUB_PATH = 'client-gallery';

/** Image-only subset — same filter as PHOTO_ALLOWED_TYPES in modelPhotosSupabase */
const GALLERY_ALLOWED_TYPES = ALLOWED_MIME_TYPES.filter((t) => t.startsWith('image/'));

// ─── Types ─────────────────────────────────────────────────────────────────

export interface UploadGalleryImageResult {
  ok: boolean;
  /** Created OrganizationProfileMedia row on success. */
  media?: OrganizationProfileMedia;
  /** Human-readable error message on failure. */
  error?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Extracts the storage path (relative to bucket root) from a public gallery URL.
 * Returns null when the URL doesn't match the expected bucket pattern.
 *
 * Input:  "https://...supabase.co/storage/v1/object/public/organization-profiles/uuid/client-gallery/ts-img.jpg"
 * Output: "uuid/client-gallery/ts-img.jpg"
 */
function extractGalleryStoragePath(imageUrl: string): string | null {
  try {
    const marker = `/object/public/${GALLERY_BUCKET}/`;
    const idx = imageUrl.indexOf(marker);
    if (idx === -1) return null;
    return imageUrl.slice(idx + marker.length);
  } catch {
    return null;
  }
}

/**
 * Derives a file extension from a MIME type.
 * Falls back to 'jpg' for unknown types.
 */
function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
  };
  return map[mime] ?? 'jpg';
}

// ─── Service Functions ──────────────────────────────────────────────────────

/**
 * Uploads a gallery image for a client organization.
 *
 * Full upload technical parity enforced before any storage write.
 * On success, creates an organization_profile_media row with
 * media_type = 'client_gallery'. If the DB insert fails, the storage
 * file is cleaned up to avoid orphans.
 *
 * Returns { ok: true, media } on success, { ok: false, error } on failure.
 */
export async function uploadClientGalleryImage(
  organizationId: string,
  file: File,
): Promise<UploadGalleryImageResult> {
  // ── Guard: org context ──
  if (!assertOrgContext(organizationId, 'uploadClientGalleryImage')) {
    return { ok: false, error: 'Organization context is missing.' };
  }

  // ── Step 1: HEIC/HEIF → JPEG conversion (abort on failure) ──
  const { file: safeFile, conversionFailed } = await convertHeicToJpegWithStatus(file);
  if (conversionFailed) {
    console.error('[uploadClientGalleryImage] HEIC conversion failed — aborting');
    return {
      ok: false,
      error: 'Could not convert image. Please try a JPEG or PNG file instead.',
    };
  }

  // ── Step 2: MIME allowlist ──
  const mimeResult = validateFile(safeFile, GALLERY_ALLOWED_TYPES);
  if (!mimeResult.ok) {
    console.error('[uploadClientGalleryImage] MIME validation failed:', mimeResult.error);
    return { ok: false, error: mimeResult.error ?? 'Invalid file type.' };
  }

  // ── Step 3: Magic bytes ──
  const magicResult = await checkMagicBytes(safeFile);
  if (!magicResult.ok) {
    console.error('[uploadClientGalleryImage] Magic bytes check failed:', magicResult.error);
    return { ok: false, error: magicResult.error ?? 'File content does not match type.' };
  }

  // ── Step 4: Extension consistency (File only, Blob skipped) ──
  if (safeFile instanceof File) {
    const extResult = checkExtensionConsistency(safeFile);
    if (!extResult.ok) {
      console.error('[uploadClientGalleryImage] Extension consistency failed:', extResult.error);
      return { ok: false, error: extResult.error ?? 'File extension mismatch.' };
    }
  }

  // ── Step 5: Build safe storage path ──
  const ext = extFromMime(safeFile.type);
  const rawBaseName = `${Date.now()}-${safeFile instanceof File ? safeFile.name : `image.${ext}`}`;
  const safeBaseName = sanitizeUploadBaseName(rawBaseName);
  const storagePath = `${organizationId}/${GALLERY_SUB_PATH}/${safeBaseName}`;

  // ── Step 6: Upload to storage (upsert:false — unique timestamp path) ──
  try {
    const { error: uploadError } = await supabase.storage
      .from(GALLERY_BUCKET)
      .upload(storagePath, safeFile, {
        upsert: false,
        contentType: safeFile.type || 'image/jpeg',
      });

    if (uploadError) {
      console.error('[uploadClientGalleryImage] Storage upload failed:', uploadError);
      return { ok: false, error: 'Upload failed. Please try again.' };
    }
  } catch (e) {
    console.error('[uploadClientGalleryImage] Storage upload exception:', e);
    return { ok: false, error: 'Upload failed. Please try again.' };
  }

  // ── Step 7: Get public URL ──
  const getUrlResult = supabase.storage.from(GALLERY_BUCKET).getPublicUrl(storagePath);
  const publicUrl = getUrlResult?.data?.publicUrl ?? null;

  if (!publicUrl) {
    void supabase.storage.from(GALLERY_BUCKET).remove([storagePath]);
    console.error('[uploadClientGalleryImage] Could not derive public URL after upload');
    return { ok: false, error: 'Upload failed. Please try again.' };
  }

  // ── Step 8: Create organization_profile_media row (sort_order: DB integer — never Date.now()) ──
  const nextSort = await getNextClientGallerySortOrder(organizationId);
  const media = await createOrganizationProfileMedia(organizationId, {
    media_type: 'client_gallery',
    image_url: publicUrl,
    sort_order: nextSort,
  });

  if (!media) {
    // DB insert failed — clean up the just-uploaded file
    void supabase.storage
      .from(GALLERY_BUCKET)
      .remove([storagePath])
      .catch((e: unknown) => {
        console.warn('[uploadClientGalleryImage] Orphan cleanup failed (non-critical):', e);
      });
    console.error('[uploadClientGalleryImage] DB insert failed, storage file cleaned up');
    return { ok: false, error: 'Could not save image. Please try again.' };
  }

  return { ok: true, media };
}

/**
 * Deletes a gallery image: removes the DB row first, then cleans up storage.
 *
 * The DB row deletion is the authoritative step (RLS `opm_owner_delete`
 * enforces owner-only access server-side). Storage removal is best-effort.
 *
 * Returns true when the DB row was successfully deleted.
 */
export async function deleteClientGalleryImage(
  organizationId: string,
  mediaId: string,
  imageUrl: string,
): Promise<boolean> {
  if (!assertOrgContext(organizationId, 'deleteClientGalleryImage')) return false;

  // ── Remove DB row (authoritative, RLS-protected) ──
  const dbOk = await deleteOrganizationProfileMedia(mediaId);
  if (!dbOk) {
    console.error('[deleteClientGalleryImage] DB delete failed for mediaId:', mediaId);
    return false;
  }

  // ── Remove storage file (best-effort, non-blocking) ──
  const storagePath = extractGalleryStoragePath(imageUrl);
  if (storagePath) {
    void supabase.storage
      .from(GALLERY_BUCKET)
      .remove([storagePath])
      .catch((e: unknown) => {
        console.warn('[deleteClientGalleryImage] Storage remove failed (non-critical):', e);
      });
  }

  return true;
}
