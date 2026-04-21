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

/**
 * Per-row override resolution — for each preview row that is `ready`, decide
 * which ISO-2 codes will end up as `model_agency_territories.country_code`
 * entries on commit. Per-row override always wins over the global default;
 * empty/whitespace override falls back to the global default. Skipped rows
 * are not included in the output.
 *
 * Pure / no React. Used by the UI to:
 *   1. block commit when ANY selected row resolves to an empty list
 *      (would create a model invisible in "My Models"),
 *   2. render a per-row "Territories: AT, DE (override)" badge,
 *   3. build the `territoriesByExternalId` payload for `commitPreview`.
 */
export function computeEffectiveTerritories(args: {
  previews: ReadonlyArray<{ externalId: string; status: string }>;
  perRowOverrides: Record<string, string>;
  globalTerritories: ReadonlyArray<string>;
}): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const p of args.previews) {
    if (p.status !== 'ready') continue;
    const override = args.perRowOverrides[p.externalId];
    const list =
      override && override.trim() ? parseTerritoryInput(override) : [...args.globalTerritories];
    map[p.externalId] = list;
  }
  return map;
}

/**
 * Pick out the externalIds whose **selected** row would commit with NO
 * territories — neither global default nor per-row override. The UI uses
 * this list to disable the commit button and surface a precise error
 * (otherwise the import would silently create models that don't show up
 * in the agency roster, because the My-Models query is fail-closed on MAT).
 */
export function findSelectedWithoutTerritory(args: {
  selected: ReadonlySet<string>;
  effective: Record<string, string[]>;
}): string[] {
  const out: string[] = [];
  for (const ext of args.selected) {
    const list = args.effective[ext] ?? [];
    if (list.length === 0) out.push(ext);
  }
  return out;
}

/**
 * Build the `territoriesByExternalId` payload for `commitPreview`. Only emits
 * entries that DIFFER from the global default — saves payload bytes and keeps
 * audit/log diffs readable. Order of `country_code` is preserved (the importer
 * uses the first one as the canonical choice for some downstream UIs).
 *
 * `agency_id` is injected here so the UI never has to know it ahead of time;
 * the importer hard-overwrites it again as defense-in-depth (see
 * `previewToImportPayload` in `packageImporter.ts`).
 */
export function buildPerRowTerritoryClaims(args: {
  toCommit: ReadonlyArray<{ externalId: string }>;
  effective: Record<string, string[]>;
  globalTerritories: ReadonlyArray<string>;
  agencyId: string;
}): Record<string, Array<{ country_code: string; agency_id: string }>> {
  const out: Record<string, Array<{ country_code: string; agency_id: string }>> = {};
  for (const p of args.toCommit) {
    const list = args.effective[p.externalId] ?? [];
    const sameAsGlobal =
      list.length === args.globalTerritories.length &&
      list.every((cc, i) => cc === args.globalTerritories[i]);
    if (!sameAsGlobal && list.length > 0) {
      out[p.externalId] = list.map((cc) => ({
        country_code: cc,
        agency_id: args.agencyId,
      }));
    }
  }
  return out;
}
