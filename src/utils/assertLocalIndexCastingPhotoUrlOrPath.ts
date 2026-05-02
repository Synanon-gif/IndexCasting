/**
 * Strict assertion for package-import / model_photos display URLs after Phase-2
 * persistence: primary `url` must point at our private `documentspictures` bucket
 * under `model-photos/`, not at Mediaslide / Netwalk CDNs or other external origins.
 *
 * Use in tests (and optionally dev-only guards). External provider URLs may exist
 * only in workflow metadata / non-display columns — never as `model_photos.url`
 * after a successful mirror upload.
 */
export function assertLocalIndexCastingPhotoUrlOrPath(url: string | null | undefined): void {
  if (url == null || String(url).trim() === '') {
    throw new Error('assertLocalIndexCastingPhotoUrlOrPath: url is empty');
  }
  const u = String(url).trim();

  if (!u.startsWith('supabase-storage://documentspictures/')) {
    throw new Error(
      `assertLocalIndexCastingPhotoUrlOrPath: expected supabase-storage://documentspictures/…, got: ${u.slice(0, 96)}`,
    );
  }
  if (!u.includes('/model-photos/')) {
    throw new Error(
      'assertLocalIndexCastingPhotoUrlOrPath: expected …/model-photos/<model_id>/… path',
    );
  }
  const lower = u.toLowerCase();
  if (
    lower.includes('mediaslide.com') ||
    lower.includes('netwalk.eu') ||
    lower.includes('netwalk.app') ||
    lower.includes('netwalkapp.com')
  ) {
    throw new Error(
      'assertLocalIndexCastingPhotoUrlOrPath: external provider host leaked into storage URI',
    );
  }
}
