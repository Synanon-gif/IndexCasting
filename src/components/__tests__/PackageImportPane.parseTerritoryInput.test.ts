/**
 * Unit tests for `parseTerritoryInput` — the small helper that converts the
 * agency's free-form territory input string into a clean list of ISO-2 codes
 * before we send them to `commitPreview`.
 *
 * These checks matter because `model_agency_territories.country_code` has a
 * CHECK on length=2 and uppercase. A typo would either crash the import OR
 * (worse) inject a non-ISO value into the roster filter, so the helper must
 * be strict and forgiving in the right places.
 */

import { parseTerritoryInput, deriveDefaultTerritoryInput } from '../PackageImportPane.utils';

describe('parseTerritoryInput', () => {
  it('returns empty array for empty input', () => {
    expect(parseTerritoryInput('')).toEqual([]);
    expect(parseTerritoryInput('   ')).toEqual([]);
  });

  it('uppercases and trims a single code', () => {
    expect(parseTerritoryInput('at')).toEqual(['AT']);
    expect(parseTerritoryInput(' at ')).toEqual(['AT']);
  });

  it('splits on comma, semicolon, slash and whitespace', () => {
    expect(parseTerritoryInput('at, de; gb / fr')).toEqual(['AT', 'DE', 'GB', 'FR']);
    expect(parseTerritoryInput('at\nde')).toEqual(['AT', 'DE']);
  });

  it('drops codes that are not exactly 2 alpha chars', () => {
    expect(parseTerritoryInput('AT, DEU, X, 12, A1')).toEqual(['AT']);
  });

  it('deduplicates while preserving order', () => {
    expect(parseTerritoryInput('AT, DE, AT, de, GB')).toEqual(['AT', 'DE', 'GB']);
  });

  it('does not crash on weird separators', () => {
    expect(parseTerritoryInput(',,,;;;//// at /// de ,,, ')).toEqual(['AT', 'DE']);
  });
});

describe('deriveDefaultTerritoryInput', () => {
  it('returns empty when value is null / undefined / empty', () => {
    expect(deriveDefaultTerritoryInput(null)).toBe('');
    expect(deriveDefaultTerritoryInput(undefined)).toBe('');
    expect(deriveDefaultTerritoryInput('')).toBe('');
    expect(deriveDefaultTerritoryInput('   ')).toBe('');
  });

  it('returns the uppercased ISO-2 code when input already looks like ISO-2', () => {
    expect(deriveDefaultTerritoryInput('at')).toBe('AT');
    expect(deriveDefaultTerritoryInput(' DE ')).toBe('DE');
  });

  it('returns empty for long country names — we never auto-map "Austria" -> "AT"', () => {
    // Reason: a wrong auto-mapping would silently broadcast the model into
    // the wrong roster. Better force the agency to type the code explicitly.
    expect(deriveDefaultTerritoryInput('Austria')).toBe('');
    expect(deriveDefaultTerritoryInput('United Kingdom')).toBe('');
    expect(deriveDefaultTerritoryInput('U.K.')).toBe('');
  });
});
