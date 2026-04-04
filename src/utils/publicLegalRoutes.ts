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
