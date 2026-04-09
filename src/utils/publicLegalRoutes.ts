import { Platform } from 'react-native';

/** Custom event so App.tsx re-reads `window.location.pathname` after client-side navigation. */
export const INDEXCASTING_LOCATION_EVENT = 'indexcasting-location';

/**
 * Maps public web paths to in-app legal screens.
 * Used for /terms and /privacy on the marketing/auth entry (no react-router).
 */
export function normalizePublicLegalPath(pathname: string): 'terms' | 'privacy' | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/terms') return 'terms';
  if (p === '/privacy') return 'privacy';
  return null;
}

export function bumpWebLocation(): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(INDEXCASTING_LOCATION_EVENT));
  }
}

/** Client-side navigation to a public legal path (no full reload). */
export function navigatePublicLegal(path: '/terms' | '/privacy'): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.history.pushState({}, '', path);
  bumpWebLocation();
}

export function replaceWebPathToHome(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.history.replaceState({}, '', '/');
  bumpWebLocation();
}

/**
 * Extracts the agency slug from a public agency profile path.
 *
 * Matches: /agency/<slug>  (alphanumeric, hyphens, underscores)
 * Returns null for: /agency/, /agency, /, /terms, /privacy, or any other path.
 *
 * Used by App.tsx to detect and render PublicAgencyProfileScreen without auth.
 */
export function getPublicAgencySlugFromPath(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, '');
  const m = p.match(/^\/agency\/([a-zA-Z0-9_-]+)$/);
  return m ? m[1] : null;
}

/**
 * Extracts the client slug from a public client profile path.
 *
 * Matches: /client/<slug>  (alphanumeric, hyphens, underscores)
 * Returns null for: /client/, /client, /, /terms, /privacy, or any other path.
 *
 * Used by App.tsx to detect and render PublicClientProfileScreen without auth.
 */
export function getPublicClientSlugFromPath(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, '');
  const m = p.match(/^\/client\/([a-zA-Z0-9_-]+)$/);
  return m ? m[1] : null;
}
