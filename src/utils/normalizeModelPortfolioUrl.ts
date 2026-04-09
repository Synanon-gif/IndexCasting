/**
 * Pure string normalisation for `models.portfolio_images` — no Supabase client import
 * (safe for Jest / apiService.js without pulling expo-constants).
 */

const DOCUMENTSPICTURES = 'documentspictures';
const MODEL_PHOTOS_PREFIX = 'model-photos';
const LEGACY_BARE_IMAGE_FILE = /^[^/\\:?*]+\.(jpe?g|png|webp|gif)$/i;

function toStorageUri(bucket: string, path: string): string {
  return `supabase-storage://${bucket}/${path}`;
}

/**
 * Normalizes `models.portfolio_images` entries for client rendering (StorageImage / signing).
 *
 * - `https:`, `http:`, `data:`, `supabase-storage://`, `supabase-private://` → returned trimmed, unchanged.
 * - Relative path starting with `model-photos/` → canonical `supabase-storage://documentspictures/...`.
 * - Bare image filename (no `/`, no `://`) → `model-photos/{modelId}/{filename}` under documentspictures.
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

  if (!s.includes('://') && !s.includes('/') && LEGACY_BARE_IMAGE_FILE.test(s)) {
    return toStorageUri(DOCUMENTSPICTURES, `${MODEL_PHOTOS_PREFIX}/${mid}/${s}`);
  }

  return s;
}
