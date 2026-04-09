/**
 * Organization Logo Upload Service — Phase 2C.2
 *
 * Owner-only logo upload / replacement / deletion for agency and client orgs.
 *
 * Storage bucket : organization-logos (public bucket; URL only surfaced via
 *                  RLS-protected organization_profiles.logo_url)
 * Storage path   : {organizationId}/{timestamp}-logo.{ext}
 *
 * Upload technical parity (upload-consent-matrix.mdc):
 *   1. HEIC/HEIF → convert to JPEG via convertHeicToJpegWithStatus; abort on failure
 *   2. validateFile — image-only MIME allowlist (no PDF)
 *   3. checkMagicBytes — byte-level MIME verification
 *   4. checkExtensionConsistency — extension vs MIME (File only)
 *   5. sanitizeUploadBaseName — safe filename
 *   6. storage.upload with upsert:false + explicit contentType
 *   7. Old logo file removed from storage after successful replacement
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
import { upsertOrganizationProfile } from './organizationProfilesSupabase';

// ─── Constants ─────────────────────────────────────────────────────────────

const LOGO_BUCKET = 'organization-logos';

/** Image-only subset — same filter as PHOTO_ALLOWED_TYPES in modelPhotosSupabase */
const LOGO_ALLOWED_TYPES = ALLOWED_MIME_TYPES.filter((t) => t.startsWith('image/'));

// ─── Types ─────────────────────────────────────────────────────────────────

export interface UploadLogoResult {
  ok: boolean;
  /** Public URL stored in organization_profiles.logo_url on success. */
  url?: string;
  /** Human-readable error message on failure. */
  error?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Extracts the storage path from a public logo URL.
 * Returns null when the URL doesn't match the expected bucket pattern.
 *
 * Input:  "https://...supabase.co/storage/v1/object/public/organization-logos/uuid/ts-logo.jpg"
 * Output: "uuid/ts-logo.jpg"
 */
function extractLogoStoragePath(logoUrl: string): string | null {
  try {
    const marker = `/object/public/${LOGO_BUCKET}/`;
    const idx = logoUrl.indexOf(marker);
    if (idx === -1) return null;
    return logoUrl.slice(idx + marker.length);
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
 * Uploads (or replaces) the organization logo.
 *
 * Full upload technical parity enforced before any storage write.
 * On success, upserts organization_profiles.logo_url and removes the previous
 * logo file from storage (cleanup is best-effort, non-blocking).
 *
 * Returns { ok: true, url } on success, { ok: false, error } on any failure.
 */
export async function uploadOrganizationLogo(
  organizationId: string,
  file: File,
): Promise<UploadLogoResult> {
  // ── Guard: org context ──
  if (!assertOrgContext(organizationId, 'uploadOrganizationLogo')) {
    return { ok: false, error: 'Organization context is missing.' };
  }

  // ── Step 1: HEIC/HEIF → JPEG conversion (abort on failure) ──
  const { file: safeFile, conversionFailed } = await convertHeicToJpegWithStatus(file);
  if (conversionFailed) {
    console.error('[uploadOrganizationLogo] HEIC conversion failed — aborting');
    return {
      ok: false,
      error: 'Could not convert image. Please try a JPEG or PNG file instead.',
    };
  }

  // ── Step 2: MIME allowlist ──
  const mimeResult = validateFile(safeFile, LOGO_ALLOWED_TYPES);
  if (!mimeResult.ok) {
    console.error('[uploadOrganizationLogo] MIME validation failed:', mimeResult.error);
    return { ok: false, error: mimeResult.error ?? 'Invalid file type.' };
  }

  // ── Step 3: Magic bytes ──
  const magicResult = await checkMagicBytes(safeFile);
  if (!magicResult.ok) {
    console.error('[uploadOrganizationLogo] Magic bytes check failed:', magicResult.error);
    return { ok: false, error: magicResult.error ?? 'File content does not match type.' };
  }

  // ── Step 4: Extension consistency (File only, Blob skipped) ──
  if (safeFile instanceof File) {
    const extResult = checkExtensionConsistency(safeFile);
    if (!extResult.ok) {
      console.error('[uploadOrganizationLogo] Extension consistency failed:', extResult.error);
      return { ok: false, error: extResult.error ?? 'File extension mismatch.' };
    }
  }

  // ── Step 5: Build safe storage path ──
  const ext = extFromMime(safeFile.type);
  const rawBaseName = `${Date.now()}-logo.${ext}`;
  const safeBaseName = sanitizeUploadBaseName(rawBaseName);
  const storagePath = `${organizationId}/${safeBaseName}`;

  // ── Step 6: Upload to storage (upsert:false — unique timestamp path) ──
  try {
    const { error: uploadError } = await supabase.storage
      .from(LOGO_BUCKET)
      .upload(storagePath, safeFile, {
        upsert: false,
        contentType: safeFile.type || 'image/jpeg',
      });

    if (uploadError) {
      console.error('[uploadOrganizationLogo] Storage upload failed:', uploadError);
      return { ok: false, error: 'Upload failed. Please try again.' };
    }
  } catch (e) {
    console.error('[uploadOrganizationLogo] Storage upload exception:', e);
    return { ok: false, error: 'Upload failed. Please try again.' };
  }

  // ── Step 7: Get public URL ──
  const getUrlResult = supabase.storage
    .from(LOGO_BUCKET)
    .getPublicUrl(storagePath);
  const publicUrl = getUrlResult?.data?.publicUrl ?? null;

  if (!publicUrl) {
    // Unexpected — clean up and abort
    void supabase.storage.from(LOGO_BUCKET).remove([storagePath]);
    console.error('[uploadOrganizationLogo] Could not derive public URL after upload');
    return { ok: false, error: 'Upload failed. Please try again.' };
  }

  // ── Step 8: Fetch existing logo_url before overwriting (for cleanup) ──
  let previousLogoUrl: string | null = null;
  try {
    const { data: existing } = await supabase
      .from('organization_profiles')
      .select('logo_url')
      .eq('organization_id', organizationId)
      .maybeSingle();
    previousLogoUrl = (existing as { logo_url: string | null } | null)?.logo_url ?? null;
  } catch {
    // Non-critical — cleanup will be skipped if fetch fails
  }

  // ── Step 9: Persist new logo_url to organization_profiles ──
  const saved = await upsertOrganizationProfile(organizationId, { logo_url: publicUrl });
  if (!saved) {
    // DB write failed — clean up the just-uploaded file (best-effort)
    void supabase.storage.from(LOGO_BUCKET).remove([storagePath]);
    console.error('[uploadOrganizationLogo] DB upsert failed, storage file cleaned up');
    return { ok: false, error: 'Could not save logo. Please try again.' };
  }

  // ── Step 10: Remove old logo file (best-effort, non-blocking) ──
  if (previousLogoUrl) {
    const oldPath = extractLogoStoragePath(previousLogoUrl);
    if (oldPath && oldPath !== storagePath) {
      void supabase.storage
        .from(LOGO_BUCKET)
        .remove([oldPath])
        .catch((e: unknown) => {
          console.warn('[uploadOrganizationLogo] Old logo cleanup failed (non-critical):', e);
        });
    }
  }

  return { ok: true, url: publicUrl };
}

/**
 * Removes the organization logo from storage and clears logo_url in the profile.
 *
 * Returns true on success (both storage removal and DB update succeed).
 * Storage removal failure is treated as non-critical when the DB update succeeds.
 */
export async function deleteOrganizationLogo(
  organizationId: string,
  currentLogoUrl: string | null,
): Promise<boolean> {
  if (!assertOrgContext(organizationId, 'deleteOrganizationLogo')) return false;

  // ── Remove file from storage (best-effort) ──
  if (currentLogoUrl) {
    const storagePath = extractLogoStoragePath(currentLogoUrl);
    if (storagePath) {
      try {
        await supabase.storage.from(LOGO_BUCKET).remove([storagePath]);
      } catch (e) {
        console.warn('[deleteOrganizationLogo] Storage remove failed (non-critical):', e);
      }
    }
  }

  // ── Clear logo_url in DB ──
  const saved = await upsertOrganizationProfile(organizationId, { logo_url: null });
  if (!saved) {
    console.error('[deleteOrganizationLogo] DB upsert failed');
    return false;
  }

  return true;
}
