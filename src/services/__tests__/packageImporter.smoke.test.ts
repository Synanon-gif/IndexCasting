/**
 * Hardened smoke tests for the provider-neutral Package Import pipeline.
 *
 * These tests intentionally try to BREAK the importer from a hostile-data angle:
 *  - cross-model image contamination
 *  - duplicate provider externalId
 *  - drift override + skip-safety
 *  - measurement field correctness (no positional drift across fields)
 *  - photo_source / sync-id slot exclusivity for both providers
 *  - regression guard: importer never invents agency_id, photo_source 'own',
 *    territories, country_code, etc.
 *
 * They live next to `packageImporter.test.ts` so a single Jest run covers both.
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('../territoriesSupabase', () => ({
  upsertTerritoriesForModelCountryAgencyPairs: jest.fn().mockResolvedValue([]),
}));

import { commitPreview, previewToImportPayload, toPreviewModels } from '../packageImporter';
import { PACKAGE_IMPORT_LIMITS, type ProviderImportPayload } from '../packageImportTypes';
import type { ImportModelAndMergeResult, ImportModelPayload } from '../modelsImportSupabase';

function msUrl(modelId: number, categoryId: number, hash: string): string {
  // Right-pad with non-zero, non-hex char 'z' so different short tags don't
  // collide after slice (e.g. 'u1' + 30 zeros == 'u10' + 29 zeros bug).
  return `https://mediaslide-europe.storage.googleapis.com/test/pictures/${modelId}/${categoryId}/large-1700000000-${hash.padEnd(32, 'z').slice(0, 32)}.jpg`;
}

function payload(overrides: Partial<ProviderImportPayload> = {}): ProviderImportPayload {
  return {
    externalProvider: 'mediaslide',
    externalId: 'MS-100',
    name: 'Test Model',
    measurements: { height: 180 },
    portfolio_image_urls: [msUrl(100, 1, 'aaaa')],
    polaroid_image_urls: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1) Cross-model contamination guard
// ---------------------------------------------------------------------------

describe('toPreviewModels — cross-model image isolation', () => {
  it('two models with completely disjoint image URLs stay disjoint after dedup+cap', () => {
    const a = payload({
      externalId: 'A',
      name: 'A',
      portfolio_image_urls: [msUrl(1, 10, 'a1'), msUrl(1, 10, 'a2'), msUrl(1, 10, 'a3')],
    });
    const b = payload({
      externalId: 'B',
      name: 'B',
      portfolio_image_urls: [msUrl(2, 20, 'b1'), msUrl(2, 20, 'b2')],
    });
    const previews = toPreviewModels([a, b]);
    expect(previews[0].portfolio_image_urls).toHaveLength(3);
    expect(previews[1].portfolio_image_urls).toHaveLength(2);
    for (const url of previews[0].portfolio_image_urls) {
      expect(previews[1].portfolio_image_urls).not.toContain(url);
    }
  });

  it('two models with the same image URL are NOT silently merged into one model', () => {
    const shared = msUrl(1, 10, 'shared');
    const a = payload({ externalId: 'A', name: 'A', portfolio_image_urls: [shared] });
    const b = payload({ externalId: 'B', name: 'B', portfolio_image_urls: [shared] });
    const previews = toPreviewModels([a, b]);
    // Each model retains its own copy (image dedup is WITHIN a single model only).
    expect(previews[0].externalId).toBe('A');
    expect(previews[1].externalId).toBe('B');
    expect(previews[0].portfolio_image_urls).toEqual([shared]);
    expect(previews[1].portfolio_image_urls).toEqual([shared]);
  });
});

// ---------------------------------------------------------------------------
// 2) Duplicate externalId warning (provider regression / list dupe)
// ---------------------------------------------------------------------------

describe('toPreviewModels — duplicate externalId surfaces a warning', () => {
  it('flags both rows with duplicate_external_id when provider returns same id twice', () => {
    const dupA = payload({ externalId: 'DUPE', name: 'Original' });
    const dupB = payload({ externalId: 'DUPE', name: 'Doppelgänger' });
    const previews = toPreviewModels([dupA, dupB]);
    expect(previews[0].warnings).toEqual(expect.arrayContaining(['duplicate_external_id:DUPE']));
    expect(previews[1].warnings).toEqual(expect.arrayContaining(['duplicate_external_id:DUPE']));
  });

  it('does NOT silently de-dupe duplicate externalId rows (agency must decide)', () => {
    const dupA = payload({ externalId: 'X' });
    const dupB = payload({ externalId: 'X' });
    const previews = toPreviewModels([dupA, dupB]);
    expect(previews).toHaveLength(2);
  });

  it('unique externalIds never get a duplicate warning', () => {
    const previews = toPreviewModels([
      payload({ externalId: '1' }),
      payload({ externalId: '2' }),
      payload({ externalId: '3' }),
    ]);
    for (const p of previews) {
      expect(p.warnings.some((w) => w.startsWith('duplicate_external_id'))).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 3) Discarded-count semantics
// ---------------------------------------------------------------------------

describe('toPreviewModels — discardedPortfolio reflects ONLY over-cap, not dedup', () => {
  it('5 dedup-removed images do NOT count as discarded (only over-cap does)', () => {
    const dup = msUrl(1, 1, 'sameKey');
    const previews = toPreviewModels([
      payload({ portfolio_image_urls: [dup, dup, dup, dup, dup] }),
    ]);
    expect(previews[0].portfolio_image_urls).toEqual([dup]);
    expect(previews[0].discardedPortfolio).toBe(0);
  });

  it('30 unique images → 20 kept, 10 discarded (only over-cap counted)', () => {
    const urls = Array.from({ length: 30 }, (_, i) => msUrl(1, 1, `u${i}`));
    const previews = toPreviewModels([payload({ portfolio_image_urls: urls })]);
    expect(previews[0].portfolio_image_urls).toHaveLength(
      PACKAGE_IMPORT_LIMITS.MAX_PORTFOLIO_IMAGES_PER_MODEL,
    );
    expect(previews[0].discardedPortfolio).toBe(
      30 - PACKAGE_IMPORT_LIMITS.MAX_PORTFOLIO_IMAGES_PER_MODEL,
    );
  });

  it('mixed: 5 dedup-removed + 25 unique above the cap → discarded = unique-cap delta only', () => {
    const dup = msUrl(1, 1, 'dup');
    const unique = Array.from({ length: 25 }, (_, i) => msUrl(1, 1, `u${i}`));
    const all = [dup, dup, dup, dup, dup, ...unique];
    const previews = toPreviewModels([payload({ portfolio_image_urls: all })]);
    // After dedup: 1 (dup) + 25 unique = 26 → cap at 20 → 6 discarded.
    expect(previews[0].portfolio_image_urls).toHaveLength(20);
    expect(previews[0].discardedPortfolio).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// 4) Measurement field correctness (no positional / cross-field drift)
// ---------------------------------------------------------------------------

describe('previewToImportPayload — measurement field exact mapping', () => {
  it('every measurement lands in its OWN field (no chest↔bust, no waist↔hips swap)', () => {
    const previews = toPreviewModels([
      payload({
        measurements: {
          height: 187,
          chest: 96,
          bust: 89,
          waist: 75,
          hips: 95,
          legs_inseam: 81,
          shoe_size: 45,
        },
        hair_color_raw: 'Dark brown',
        eye_color_raw: 'Green brown',
      }),
    ]);
    const p = previewToImportPayload({ preview: previews[0], agencyId: 'a-1', options: {} });
    expect(p.height).toBe(187);
    expect(p.chest).toBe(96);
    expect(p.bust).toBe(89);
    expect(p.waist).toBe(75);
    expect(p.hips).toBe(95);
    expect(p.legs_inseam).toBe(81);
    expect(p.shoe_size).toBe(45);
    expect(p.hair_color).toBe('Dark brown');
    expect(p.eye_color).toBe('Green brown');
  });

  it('hair vs eyes are not swapped even if eye field is null', () => {
    const previews = toPreviewModels([payload({ hair_color_raw: 'Blonde', eye_color_raw: null })]);
    const p = previewToImportPayload({ preview: previews[0], agencyId: 'a-1', options: {} });
    expect(p.hair_color).toBe('Blonde');
    expect(p.eye_color).toBeNull();
  });

  it('shoe_size is forwarded as-is (no EU/US conversion silently applied)', () => {
    const previews = toPreviewModels([payload({ measurements: { height: 180, shoe_size: 41 } })]);
    const p = previewToImportPayload({ preview: previews[0], agencyId: 'a-1', options: {} });
    expect(p.shoe_size).toBe(41);
  });
});

// ---------------------------------------------------------------------------
// 5) Provider-neutral sync slot exclusivity
// ---------------------------------------------------------------------------

describe('previewToImportPayload — sync slot exclusivity per provider', () => {
  it('mediaslide payload sets ONLY mediaslide_sync_id', () => {
    const previews = toPreviewModels([
      payload({ externalProvider: 'mediaslide', externalId: 'MS-1' }),
    ]);
    const p = previewToImportPayload({ preview: previews[0], agencyId: 'a-1', options: {} });
    expect(p.mediaslide_sync_id).toBe('MS-1');
    expect(p.netwalk_model_id).toBeUndefined();
  });

  it('netwalk payload sets ONLY netwalk_model_id', () => {
    const previews = toPreviewModels([
      payload({ externalProvider: 'netwalk', externalId: 'NW-1' }),
    ]);
    const p = previewToImportPayload({ preview: previews[0], agencyId: 'a-1', options: {} });
    expect(p.netwalk_model_id).toBe('NW-1');
    expect(p.mediaslide_sync_id).toBeUndefined();
  });

  it('photo_source matches the provider id exactly (mediaslide → mediaslide)', () => {
    const previews = toPreviewModels([
      payload({ externalProvider: 'mediaslide', externalId: 'MS-1' }),
    ]);
    const p = previewToImportPayload({ preview: previews[0], agencyId: 'a-1', options: {} });
    expect(p.photo_source).toBe('mediaslide');
  });

  it('photo_source matches the provider id exactly (netwalk → netwalk)', () => {
    const previews = toPreviewModels([
      payload({ externalProvider: 'netwalk', externalId: 'NW-1' }),
    ]);
    const p = previewToImportPayload({ preview: previews[0], agencyId: 'a-1', options: {} });
    expect(p.photo_source).toBe('netwalk');
  });

  it('photo_source is NEVER "own" for a package import payload', () => {
    for (const provider of ['mediaslide', 'netwalk'] as const) {
      const previews = toPreviewModels([payload({ externalProvider: provider })]);
      const p = previewToImportPayload({ preview: previews[0], agencyId: 'a-1', options: {} });
      expect(p.photo_source).not.toBe('own');
    }
  });
});

// ---------------------------------------------------------------------------
// 6) Provider can NEVER inject agency_id / sensitive fields
// ---------------------------------------------------------------------------

describe('previewToImportPayload — provider cannot poison sensitive fields', () => {
  it('agency_id is taken from caller, never from payload (no agency_id in ProviderImportPayload anyway)', () => {
    const previews = toPreviewModels([payload()]);
    const p = previewToImportPayload({
      preview: previews[0],
      agencyId: 'caller-agency',
      options: {},
    });
    expect(p.agency_id).toBe('caller-agency');
  });

  it('country_code, territories, sex, ethnicity, email, birthday remain untouched', () => {
    const previews = toPreviewModels([payload()]);
    const p = previewToImportPayload({ preview: previews[0], agencyId: 'a-1', options: {} });
    expect(p.country_code).toBeUndefined();
    expect(p.territories).toBeUndefined();
    expect(p.sex).toBeUndefined();
    expect(p.ethnicity).toBeUndefined();
    expect(p.email).toBeUndefined();
    expect(p.birthday).toBeUndefined();
    expect(p.is_visible_commercial).toBeUndefined();
    expect(p.is_visible_fashion).toBeUndefined();
  });

  it('throws synchronously when status is not ready (cannot bypass to importer)', () => {
    const previews = toPreviewModels([
      payload({ portfolio_image_urls: [], polaroid_image_urls: [] }),
    ]);
    expect(previews[0].status).toBe('skipped');
    expect(() =>
      previewToImportPayload({ preview: previews[0], agencyId: 'a-1', options: {} }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 7) Drift-bypass / override + DB-safety regression
// ---------------------------------------------------------------------------

describe('commitPreview — drift override never bypasses DB-safety skips', () => {
  it('forceSkipReason set by provider (e.g. book_fetch_failed) is honoured even with images', async () => {
    const previews = toPreviewModels([
      payload({
        forceSkipReason: 'book_fetch_failed',
        portfolio_image_urls: [msUrl(1, 1, 'x1')],
      }),
    ]);
    const importImpl = jest.fn();
    const summary = await commitPreview({
      selected: previews,
      agencyId: 'a-1',
      options: {},
      importImpl: importImpl as unknown as (
        p: ImportModelPayload,
      ) => Promise<ImportModelAndMergeResult | null>,
    });
    expect(importImpl).not.toHaveBeenCalled();
    expect(summary.skippedCount).toBe(1);
    expect(summary.outcomes[0]).toMatchObject({
      status: 'skipped',
      reason: 'book_fetch_failed',
    });
  });

  it('a mixed batch (some skipped + some ready) only commits ready models', async () => {
    const previews = toPreviewModels([
      payload({ externalId: 'OK1', name: 'OK1' }),
      payload({
        externalId: 'BAD',
        name: 'BAD',
        forceSkipReason: 'book_fetch_failed',
      }),
      payload({ externalId: 'OK2', name: 'OK2' }),
    ]);
    const calls: string[] = [];
    const importImpl = jest.fn(async (p: ImportModelPayload) => {
      calls.push(p.mediaslide_sync_id ?? '?');
      return { model_id: `m-${p.mediaslide_sync_id}`, created: true };
    });
    const summary = await commitPreview({
      selected: previews,
      agencyId: 'a-1',
      options: {},
      importImpl,
    });
    expect(calls).toEqual(['OK1', 'OK2']);
    expect(summary.createdCount).toBe(2);
    expect(summary.skippedCount).toBe(1);
  });

  it('an importer that rejects with an Error never crashes the whole batch', async () => {
    const previews = toPreviewModels([payload({ externalId: '1' }), payload({ externalId: '2' })]);
    const importImpl = jest.fn(async (p: ImportModelPayload) => {
      if (p.mediaslide_sync_id === '1') throw new Error('rls_denied');
      return { model_id: 'm-2', created: true };
    });
    const summary = await commitPreview({
      selected: previews,
      agencyId: 'a-1',
      options: {},
      importImpl,
    });
    expect(summary.errorCount).toBe(1);
    expect(summary.createdCount).toBe(1);
    expect(summary.outcomes[0]).toMatchObject({
      status: 'error',
      reason: expect.stringContaining('rls_denied'),
    });
  });
});

// ---------------------------------------------------------------------------
// 8) Reimport / merge path correctness
// ---------------------------------------------------------------------------

describe('commitPreview — reimport / merge semantics via importer', () => {
  it('forceUpdateMeasurements=false → importer receives false (DB merge fills only gaps)', async () => {
    const previews = toPreviewModels([payload()]);
    const captured: ImportModelPayload[] = [];
    const importImpl = jest.fn(async (p: ImportModelPayload) => {
      captured.push(p);
      return { model_id: 'm-1', created: false } as ImportModelAndMergeResult;
    });
    await commitPreview({
      selected: previews,
      agencyId: 'a-1',
      options: { forceUpdateMeasurements: false },
      importImpl,
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].forceUpdateMeasurements).toBe(false);
  });

  it('forceUpdateMeasurements=true → importer receives true (Mediaslide is authoritative)', async () => {
    const previews = toPreviewModels([payload()]);
    const captured: ImportModelPayload[] = [];
    const importImpl = jest.fn(async (p: ImportModelPayload) => {
      captured.push(p);
      return { model_id: 'm-1', created: false } as ImportModelAndMergeResult;
    });
    await commitPreview({
      selected: previews,
      agencyId: 'a-1',
      options: { forceUpdateMeasurements: true },
      importImpl,
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].forceUpdateMeasurements).toBe(true);
  });

  it('externalSyncIdsPersistFailed surfaces as warning (model_id still useful)', async () => {
    const previews = toPreviewModels([payload({ externalId: 'SYNC' })]);
    const importImpl = jest.fn(async () => ({
      model_id: 'm-1',
      created: false,
      externalSyncIdsPersistFailed: true,
    }));
    const summary = await commitPreview({
      selected: previews,
      agencyId: 'a-1',
      options: {},
      importImpl,
    });
    expect(summary.warningCount).toBe(1);
    expect(summary.outcomes[0]).toMatchObject({
      status: 'warning',
      modelId: 'm-1',
      reason: 'external_sync_ids_persist_failed',
    });
  });
});
