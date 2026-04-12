/**
 * Pure string normalisation for `models.portfolio_images` — no Supabase client import
 * (safe for Jest / apiService.js without pulling expo-constants).
 *
 * HARDENING (2026-04-12): additional patterns for model-applications/ paths
 * and relative paths with sub-directories (e.g. "{modelId}/file.jpg").
 */

const DOCUMENTSPICTURES = 'documentspictures';
const MODEL_PHOTOS_PREFIX = 'model-photos';
const MODEL_APPLICATIONS_PREFIX = 'model-applications';
const LEGACY_BARE_IMAGE_FILE = /^[^/\\:?*]+\.(jpe?g|png|webp|gif|heic|heif)$/i;
const RELATIVE_WITH_SUBDIR = /^[a-f0-9-]+\/[^/\\:?*]+\.(jpe?g|png|webp|gif|heic|heif)$/i;

function toStorageUri(bucket: string, path: string): string {
  return `supabase-storage://${bucket}/${path}`;
}

/**
 * Normalizes image references from DB mirror columns (`models.portfolio_images`,
 * `models.polaroids`) and application image slots for rendering via StorageImage.
 *
 * Handles all known formats:
 *   - `https:`, `http:`, `data:` URLs → returned as-is
 *   - `supabase-storage://…`, `supabase-private://…` → returned as-is (already canonical)
 *   - `model-photos/…` relative path → `supabase-storage://documentspictures/model-photos/…`
 *   - `model-applications/…` relative path → `supabase-storage://documentspictures/model-applications/…`
 *   - `{uuid}/filename.jpg` (modelId sub-dir) → `supabase-storage://documentspictures/model-photos/{uuid}/filename.jpg`
 *   - Bare filename `image.jpg` → `supabase-storage://documentspictures/model-photos/{modelId}/image.jpg`
 */
export function normalizeDocumentspicturesModelImageRef(
  raw: string,
  modelId: string,
): string {
  const s = (raw ?? '').trim();
  if (!s) return s;
  const mid = (modelId ?? '').trim();
  if (!mid) return s;

  if (
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('data:') ||
    s.startsWith('supabase-storage://') ||
    s.startsWith('supabase-private://')
  ) {
    return s;
  }

  if (s.startsWith(`${MODEL_PHOTOS_PREFIX}/`)) {
    return toStorageUri(DOCUMENTSPICTURES, s);
  }

  if (s.startsWith(`${MODEL_APPLICATIONS_PREFIX}/`)) {
    return toStorageUri(DOCUMENTSPICTURES, s);
  }

  // Relative path like "{uuid}/filename.jpg" — assume model-photos sub-directory
  if (!s.includes('://') && RELATIVE_WITH_SUBDIR.test(s)) {
    return toStorageUri(DOCUMENTSPICTURES, `${MODEL_PHOTOS_PREFIX}/${s}`);
  }

  if (!s.includes('://') && !s.includes('/') && LEGACY_BARE_IMAGE_FILE.test(s)) {
    return toStorageUri(DOCUMENTSPICTURES, `${MODEL_PHOTOS_PREFIX}/${mid}/${s}`);
  }

  return s;
}
