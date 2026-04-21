/**
 * Pure helpers used by `PackageImportPane`. Extracted so they can be unit
 * tested without pulling in the React Native runtime (jsx, react-native,
 * theme assets) — the test runner doesn't need any of that to verify the
 * territory-input parsing rules.
 *
 * Why these matter:
 *   `model_agency_territories.country_code` has a length=2 + uppercase
 *   constraint. A typo here would either crash the import OR (worse) inject
 *   a non-ISO value into the agency roster filter — so the parser must be
 *   strict (drop non-ISO) and forgiving (accept commas, spaces, semicolons,
 *   slashes, mixed case, dups).
 */

/**
 * Parse a free-form string like "AT, DE, GB" into a deduplicated, uppercased
 * list of ISO-2 codes. Anything that isn't 2 alpha chars is dropped silently.
 */
export function parseTerritoryInput(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of (raw ?? '').split(/[\s,;/]+/)) {
    const code = part.trim().toUpperCase();
    if (code.length !== 2) continue;
    if (!/^[A-Z]{2}$/.test(code)) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

/**
 * Pre-fill the territory input from an `agencies.country` value, but ONLY if
 * it already looks like an ISO-2 code. We deliberately do NOT auto-map long
 * country names (e.g. "Austria" -> "AT") because a wrong mapping would
 * silently broadcast the model into the wrong agency roster.
 */
export function deriveDefaultTerritoryInput(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;
  return '';
}
