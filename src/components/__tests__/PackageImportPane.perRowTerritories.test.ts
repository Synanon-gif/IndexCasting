/**
 * Unit tests for the per-row territory override helpers used by
 * `PackageImportPane`. These three helpers run on every render and on every
 * commit attempt — getting them wrong would either:
 *
 *   - silently create a model with NO `model_agency_territories` rows
 *     (model invisible in "My Models" — exactly the user-reported bug), or
 *   - leak the agency's global default into a row the agency wanted to
 *     restrict to a single country, or
 *   - inject `country_code` values that violate the DB CHECK (length=2,
 *     uppercase ASCII) and abort the whole batch.
 *
 * The helpers are pure (no React, no DB) so they get full coverage here.
 */

import {
  buildPerRowTerritoryClaims,
  computeEffectiveTerritories,
  findSelectedWithoutTerritory,
} from '../PackageImportPane.utils';

type P = { externalId: string; status: string };

describe('computeEffectiveTerritories', () => {
  it('falls back to globalTerritories when override is empty / whitespace', () => {
    const previews: P[] = [
      { externalId: 'A', status: 'ready' },
      { externalId: 'B', status: 'ready' },
    ];
    const result = computeEffectiveTerritories({
      previews,
      perRowOverrides: { A: '', B: '   ' },
      globalTerritories: ['AT', 'DE'],
    });
    expect(result).toEqual({ A: ['AT', 'DE'], B: ['AT', 'DE'] });
  });

  it('per-row override completely replaces the global list when non-empty', () => {
    const previews: P[] = [
      { externalId: 'A', status: 'ready' },
      { externalId: 'B', status: 'ready' },
    ];
    const result = computeEffectiveTerritories({
      previews,
      perRowOverrides: { A: 'gb, fr', B: '' },
      globalTerritories: ['AT'],
    });
    expect(result).toEqual({ A: ['GB', 'FR'], B: ['AT'] });
  });

  it('skips rows whose status is not "ready" (skipped models never get a MAT row)', () => {
    const previews: P[] = [
      { externalId: 'A', status: 'ready' },
      { externalId: 'SKIP', status: 'skipped' },
      { externalId: 'BAD', status: 'preview_error' },
    ];
    const result = computeEffectiveTerritories({
      previews,
      perRowOverrides: { SKIP: 'AT', BAD: 'AT' },
      globalTerritories: ['AT'],
    });
    expect(Object.keys(result)).toEqual(['A']);
  });

  it('returns an empty list when override has only invalid codes (caller must block commit)', () => {
    const previews: P[] = [{ externalId: 'A', status: 'ready' }];
    const result = computeEffectiveTerritories({
      previews,
      perRowOverrides: { A: 'XYZ, 12, A1' },
      globalTerritories: ['AT'],
    });
    expect(result.A).toEqual([]);
  });
});

describe('findSelectedWithoutTerritory', () => {
  it('returns externalIds whose effective list is empty', () => {
    const result = findSelectedWithoutTerritory({
      selected: new Set(['A', 'B', 'C']),
      effective: { A: ['AT'], B: [], C: ['DE'] },
    });
    expect(result).toEqual(['B']);
  });

  it('treats missing-from-map the same as empty (defense against state drift)', () => {
    const result = findSelectedWithoutTerritory({
      selected: new Set(['A', 'GHOST']),
      effective: { A: ['AT'] },
    });
    expect(result).toEqual(['GHOST']);
  });

  it('returns [] when every selected row has at least one ISO-2 code', () => {
    const result = findSelectedWithoutTerritory({
      selected: new Set(['A']),
      effective: { A: ['AT'] },
    });
    expect(result).toEqual([]);
  });
});

describe('buildPerRowTerritoryClaims', () => {
  it('emits ONLY rows that differ from the global default (payload diet + readable audit)', () => {
    const out = buildPerRowTerritoryClaims({
      toCommit: [{ externalId: 'A' }, { externalId: 'B' }],
      effective: { A: ['AT'], B: ['GB', 'FR'] },
      globalTerritories: ['AT'],
      agencyId: 'agency-1',
    });
    expect(Object.keys(out)).toEqual(['B']);
    expect(out.B).toEqual([
      { country_code: 'GB', agency_id: 'agency-1' },
      { country_code: 'FR', agency_id: 'agency-1' },
    ]);
  });

  it('does not emit a row whose effective list is identical to the global list (same order)', () => {
    const out = buildPerRowTerritoryClaims({
      toCommit: [{ externalId: 'A' }],
      effective: { A: ['AT', 'DE'] },
      globalTerritories: ['AT', 'DE'],
      agencyId: 'a',
    });
    expect(out).toEqual({});
  });

  it('treats different ORDER as different (a manual override "DE,AT" is not the same as global "AT,DE")', () => {
    const out = buildPerRowTerritoryClaims({
      toCommit: [{ externalId: 'A' }],
      effective: { A: ['DE', 'AT'] },
      globalTerritories: ['AT', 'DE'],
      agencyId: 'a',
    });
    expect(out.A).toEqual([
      { country_code: 'DE', agency_id: 'a' },
      { country_code: 'AT', agency_id: 'a' },
    ]);
  });

  it('skips empty effective lists (caller is expected to have blocked commit already)', () => {
    const out = buildPerRowTerritoryClaims({
      toCommit: [{ externalId: 'A' }],
      effective: { A: [] },
      globalTerritories: ['AT'],
      agencyId: 'a',
    });
    expect(out).toEqual({});
  });

  it('always sets agency_id from the parameter (UI cannot inject foreign agency)', () => {
    const out = buildPerRowTerritoryClaims({
      toCommit: [{ externalId: 'A' }],
      effective: { A: ['GB'] },
      globalTerritories: ['AT'],
      agencyId: 'agency-OWNER',
    });
    expect(out.A.every((c) => c.agency_id === 'agency-OWNER')).toBe(true);
  });
});

describe('integration — UI invariants for the territory pipeline', () => {
  it('a per-row override for ONE model in a 3-model batch leaves the other two on the global default', () => {
    const previews: P[] = [
      { externalId: 'A', status: 'ready' },
      { externalId: 'B', status: 'ready' },
      { externalId: 'C', status: 'ready' },
    ];
    const eff = computeEffectiveTerritories({
      previews,
      perRowOverrides: { B: 'gb' },
      globalTerritories: ['AT'],
    });
    const claims = buildPerRowTerritoryClaims({
      toCommit: previews,
      effective: eff,
      globalTerritories: ['AT'],
      agencyId: 'a',
    });
    // Only B is in claims; A & C will use the importer's `options.territories` global.
    expect(Object.keys(claims)).toEqual(['B']);
    expect(claims.B).toEqual([{ country_code: 'GB', agency_id: 'a' }]);
  });

  it('global empty + per-row override on every model still passes findSelectedWithoutTerritory', () => {
    const previews: P[] = [
      { externalId: 'A', status: 'ready' },
      { externalId: 'B', status: 'ready' },
    ];
    const eff = computeEffectiveTerritories({
      previews,
      perRowOverrides: { A: 'AT', B: 'DE' },
      globalTerritories: [],
    });
    const missing = findSelectedWithoutTerritory({
      selected: new Set(['A', 'B']),
      effective: eff,
    });
    expect(missing).toEqual([]);
  });

  it('global empty + missing per-row override flags ALL selected rows as missing (UI blocks commit)', () => {
    const previews: P[] = [
      { externalId: 'A', status: 'ready' },
      { externalId: 'B', status: 'ready' },
    ];
    const eff = computeEffectiveTerritories({
      previews,
      perRowOverrides: {},
      globalTerritories: [],
    });
    const missing = findSelectedWithoutTerritory({
      selected: new Set(['A', 'B']),
      effective: eff,
    });
    expect(missing.sort()).toEqual(['A', 'B']);
  });
});
