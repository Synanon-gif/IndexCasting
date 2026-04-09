/**
 * Validation and formatting utilities for public agency profile settings.
 * Phase 3A.2 — Pure functions, no React imports. Testable in isolation.
 *
 * Slug rules (must match DB CHECK constraint organization_profiles_slug_format):
 *   - Only lowercase a–z, digits 0–9, and hyphens
 *   - Cannot start or end with a hyphen
 *   - Minimum 2 characters, maximum 60 characters
 *   - Single-character slugs allowed only if alphanumeric (a-z / 0-9)
 */

/**
 * Validates a slug string.
 * Returns a human-readable error string if invalid, or null if valid.
 *
 * Called before saving public settings to prevent a round-trip to the DB
 * for obviously invalid inputs.
 */
export function validateSlug(slug: string): string | null {
  const t = slug.trim();

  if (!t) return 'Slug is required.';
  if (t.length < 2) return 'Too short (min 2 characters).';
  if (t.length > 60) return 'Too long (max 60 characters).';

  // Match single alphanumeric OR multi-char (no leading/trailing hyphens)
  const singleChar = /^[a-z0-9]$/.test(t);
  const multiChar = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(t);

  if (!singleChar && !multiChar) {
    return 'Only lowercase letters, numbers, and hyphens. Cannot start or end with a hyphen.';
  }

  return null; // valid
}

/**
 * Converts an arbitrary string into a slug-safe candidate.
 * Intended for UX auto-hint only — does NOT guarantee validity (result may be
 * too short). Always run validateSlug() on the result before saving.
 */
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** The base public URL used for the URL preview in the UI. */
export const PUBLIC_AGENCY_BASE_URL = 'index-casting.com/agency';

/**
 * Returns the full public URL for an agency slug (display only).
 * Returns null when slug is empty or null.
 */
export function publicAgencyUrl(slug: string | null | undefined): string | null {
  const t = slug?.trim();
  if (!t) return null;
  return `${PUBLIC_AGENCY_BASE_URL}/${t}`;
}

/**
 * Returns the full https:// URL for clipboard writes and Linking.openURL.
 * Returns null when slug is empty or null.
 *
 * Separate from publicAgencyUrl so display text and href are always consistent
 * and the https:// prefix is never duplicated across call sites.
 */
export function publicAgencyHref(slug: string | null | undefined): string | null {
  const t = slug?.trim();
  if (!t) return null;
  return `https://${PUBLIC_AGENCY_BASE_URL}/${t}`;
}

/** The base public URL used for the URL preview in the UI for client profiles. */
export const PUBLIC_CLIENT_BASE_URL = 'index-casting.com/client';

/**
 * Returns the display-only public URL for a client slug.
 * Returns null when slug is empty or null.
 */
export function publicClientUrl(slug: string | null | undefined): string | null {
  const t = slug?.trim();
  if (!t) return null;
  return `${PUBLIC_CLIENT_BASE_URL}/${t}`;
}

/**
 * Returns the full https:// URL for clipboard writes and Linking.openURL.
 * Returns null when slug is empty or null.
 *
 * Separate from publicClientUrl so display text and href are always consistent
 * and the https:// prefix is never duplicated across call sites.
 */
export function publicClientHref(slug: string | null | undefined): string | null {
  const t = slug?.trim();
  if (!t) return null;
  return `https://${PUBLIC_CLIENT_BASE_URL}/${t}`;
}
