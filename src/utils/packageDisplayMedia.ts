import type { PackageType } from '../services/guestLinksSupabase';

/** Rows / summaries that expose the two guest-package image arrays. */
export type PackageMediaFields = {
  portfolio_images?: string[] | null;
  polaroids?: string[] | null;
};

/**
 * Viewer-chosen display kind. For `'portfolio'` and `'polaroid'` packages this
 * always equals the package type. For `'mixed'` packages the viewer toggles
 * between the two.
 */
export type PackageDisplayMode = 'portfolio' | 'polaroid';

/**
 * Normalizes link / metadata `type` to a canonical package kind.
 * Unknown values default to portfolio (safe for image selection).
 */
export function normalizePackageType(t: unknown): PackageType {
  const s = String(t ?? '')
    .toLowerCase()
    .trim();
  if (s === 'polaroid') return 'polaroid';
  if (s === 'mixed') return 'mixed';
  return 'portfolio';
}

/**
 * Default display mode for a package: portfolio packages → 'portfolio',
 * polaroid packages → 'polaroid', mixed → 'portfolio' (viewer can switch).
 */
export function defaultDisplayModeForPackage(packageType: PackageType): PackageDisplayMode {
  return packageType === 'polaroid' ? 'polaroid' : 'portfolio';
}

/**
 * Canonical image list for package UI.
 * - For 'portfolio' / 'polaroid' packages: returns that single bucket.
 * - For 'mixed' packages: returns whichever bucket the viewer currently selected
 *   via `displayMode`. If `displayMode` is omitted, falls back to portfolio.
 *
 * Existing call sites that pass `packageType` directly continue to work
 * unchanged (mixed → portfolio default).
 */
export function getPackageDisplayImages(
  m: PackageMediaFields | null | undefined,
  packageType: PackageType,
  displayMode?: PackageDisplayMode,
): string[] {
  if (!m) return [];
  const mode: PackageDisplayMode =
    packageType === 'mixed' ? (displayMode ?? 'portfolio') : (packageType as PackageDisplayMode);
  if (mode === 'polaroid') {
    return [...(m.polaroids ?? [])];
  }
  return [...(m.portfolio_images ?? [])];
}

/** First display ref (raw) for cover — caller should run normalizeDocumentspicturesModelImageRef. */
export function getPackageCoverRawRef(
  m: PackageMediaFields | null | undefined,
  packageType: PackageType,
  displayMode?: PackageDisplayMode,
): string {
  const imgs = getPackageDisplayImages(m, packageType, displayMode);
  if (imgs[0]) return imgs[0];
  // Mixed cover fallback: try the other bucket so an empty portfolio doesn't
  // wipe the cover when polaroids exist (and vice versa).
  if (packageType === 'mixed') {
    const fallback =
      (displayMode ?? 'portfolio') === 'portfolio'
        ? [...(m?.polaroids ?? [])]
        : [...(m?.portfolio_images ?? [])];
    return fallback[0] ?? '';
  }
  return '';
}

/**
 * Returns true when a mixed package actually has images in *both* buckets and
 * the toggle UI should be shown. Portfolio-/Polaroid-only packages never need
 * the toggle.
 */
export function packageHasBothBuckets(
  m: PackageMediaFields | null | undefined,
  packageType: PackageType,
): boolean {
  if (packageType !== 'mixed' || !m) return false;
  const portfolio = (m.portfolio_images ?? []).filter(
    (s) => typeof s === 'string' && s.trim() !== '',
  );
  const polaroids = (m.polaroids ?? []).filter((s) => typeof s === 'string' && s.trim() !== '');
  return portfolio.length > 0 && polaroids.length > 0;
}
