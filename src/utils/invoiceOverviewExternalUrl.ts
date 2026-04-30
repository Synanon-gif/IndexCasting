/**
 * Double-check invoice overview outbound links (defense in depth; SQL already filters).
 * Never expose storage paths or non-HTTPS URLs to the UI.
 */

const STRIPE_HOST_RE = /^([a-zA-Z0-9-]+\.)*stripe\.com$/;

export function isSafeInvoiceOverviewExternalUrl(url: string | null | undefined): boolean {
  if (url == null || typeof url !== 'string') return false;
  const t = url.trim();
  if (!t.startsWith('https://')) return false;
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:') return false;
    return STRIPE_HOST_RE.test(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}
