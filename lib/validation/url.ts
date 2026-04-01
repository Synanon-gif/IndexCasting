/**
 * URL validation utilities.
 * Enforces HTTPS-only links and prevents protocol-injection attacks.
 * All links rendered in the UI MUST use safeLinkProps.
 */

import type { ValidationResult } from './text';

/** Allowed URL protocols. Only https is permitted for user-submitted links. */
const ALLOWED_PROTOCOLS = ['https:'];

/**
 * Blocked protocols that must never appear in user-provided URLs.
 * Prevents XSS via javascript:, data:, vbscript:, file:, etc.
 */
const BLOCKED_PROTOCOLS = [
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'blob:',
  'ftp:',
];

/**
 * Validates a single URL string.
 * - Must use https:// protocol.
 * - Must be a structurally valid URL.
 * - Must not contain blocked protocols (javascript:, data:, …).
 */
export function validateUrl(input: string): ValidationResult {
  const trimmed = input.trim();

  // Quick block of known-dangerous protocol prefixes (case-insensitive)
  const lower = trimmed.toLowerCase();
  for (const blocked of BLOCKED_PROTOCOLS) {
    if (lower.startsWith(blocked)) {
      return { ok: false, error: `URL protocol "${blocked}" is not allowed.` };
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Invalid URL format.' };
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return {
      ok: false,
      error: `Only HTTPS links are allowed. Received protocol: "${parsed.protocol}"`,
    };
  }

  return { ok: true };
}

/**
 * Extracts all valid https:// URLs from a free-text string.
 * URLs that fail protocol validation are silently dropped.
 */
export function extractSafeUrls(text: string): string[] {
  const urlPattern = /https?:\/\/[^\s<>"']+/gi;
  const matches = text.match(urlPattern) ?? [];
  return matches.filter((url) => validateUrl(url).ok);
}

/**
 * Safe link props to be spread on every anchor element that opens user-provided URLs.
 * - noopener: prevents the new tab from accessing window.opener (tab-napping)
 * - noreferrer: prevents sending the Referer header (privacy)
 * - nofollow: signals to search engines not to follow user-generated links (SEO safety)
 *
 * Usage (React):
 *   <a href={url} {...safeLinkProps}>link text</a>
 */
export const safeLinkProps = {
  target: '_blank',
  rel: 'noopener noreferrer nofollow',
} as const;
