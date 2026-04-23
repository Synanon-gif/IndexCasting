import { Platform } from 'react-native';
import { validateUrl } from '../../lib/validation';
import { openLinkWithFeedback } from './openLinkWithFeedback';

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

/**
 * Trust Center route identifiers — public, unauthenticated.
 * Each maps to a static read-only TSX page under src/views/trust/.
 */
export type TrustRoute =
  | 'trust-center'
  | 'trust-security'
  | 'trust-dpa'
  | 'trust-subprocessors'
  | 'trust-gdpr'
  | 'trust-incident-response';

/**
 * Maps a public web pathname to a Trust Center route, or null if it does not match.
 * Trust pages live entirely outside auth/session and may be visited by anyone.
 */
export function normalizeTrustPath(pathname: string): TrustRoute | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/trust') return 'trust-center';
  if (p === '/trust/security') return 'trust-security';
  if (p === '/trust/dpa') return 'trust-dpa';
  if (p === '/trust/subprocessors') return 'trust-subprocessors';
  if (p === '/trust/gdpr') return 'trust-gdpr';
  if (p === '/trust/incident-response') return 'trust-incident-response';
  return null;
}

/** Returns true if the given pathname matches the public live status page. */
export function isStatusPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/';
  return p === '/status';
}

/**
 * Client-side navigation helper for Trust / Status routes (web only, no full reload).
 */
export function navigatePublicPath(path: string): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.history.pushState({}, '', path);
  bumpWebLocation();
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

/** Public Trust / System Status: web uses client-side route; native opens the hosted canonical URL. */
export type AuthAreaPublicPageSpec = {
  webPath: string;
  publicUrl: string;
};

export function openAuthAreaPublicPage(spec: AuthAreaPublicPageSpec): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    navigatePublicPath(spec.webPath);
    return;
  }
  if (validateUrl(spec.publicUrl).ok) {
    openLinkWithFeedback(spec.publicUrl);
  }
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
