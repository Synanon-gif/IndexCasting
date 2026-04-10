import type { PackageType } from '../services/guestLinksSupabase';

/** Rows / summaries that expose the two guest-package image arrays. */
export type PackageMediaFields = {
  portfolio_images?: string[] | null;
  polaroids?: string[] | null;
};

/**
 * Normalizes link / metadata `type` to a canonical package kind.
 * Unknown values default to portfolio (safe for image selection).
 */
export function normalizePackageType(t: unknown): PackageType {
  const s = String(t ?? '').toLowerCase().trim();
  return s === 'polaroid' ? 'polaroid' : 'portfolio';
}

/**
 * Canonical image list for package UI: portfolio packages → portfolio_images only;
 * polaroid packages → polaroids only (never mixed).
 */
export function getPackageDisplayImages(
  m: PackageMediaFields | null | undefined,
  packageType: PackageType,
): string[] {
  if (!m) return [];
  if (packageType === 'polaroid') {
    return [...(m.polaroids ?? [])];
  }
  return [...(m.portfolio_images ?? [])];
}

/** First display ref (raw) for cover — caller should run normalizeDocumentspicturesModelImageRef. */
export function getPackageCoverRawRef(
  m: PackageMediaFields | null | undefined,
  packageType: PackageType,
): string {
  const imgs = getPackageDisplayImages(m, packageType);
  return imgs[0] ?? '';
}
