// Stub Supabase + downstream module chain so we can import packageImporter without expo-constants.
jest.mock('../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('../territoriesSupabase', () => ({
  upsertTerritoriesForModelCountryAgencyPairs: jest.fn().mockResolvedValue([]),
}));

import { PACKAGE_IMPORT_LIMITS, type ProviderImportPayload } from '../packageImportTypes';
import { commitPreview, previewToImportPayload, toPreviewModels } from '../packageImporter';
import type { ImportModelAndMergeResult, ImportModelPayload } from '../modelsImportSupabase';

function makePayload(overrides: Partial<ProviderImportPayload> = {}): ProviderImportPayload {
  return {
    externalProvider: 'mediaslide',
    externalId: 'MS-100',
    name: 'Test Model',
    measurements: { height: 180 },
    // Default: 1 portfolio image so the payload becomes 'ready' under the
    // empty-ready guard. Tests that explicitly want the no_images path override
    // both arrays to [].
    portfolio_image_urls: ['https://x/y/pictures/1/1/large-1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'],
    polaroid_image_urls: [],
    ...overrides,
  };
}

function makeUrl(modelId: number, categoryId: number, hash: string): string {
  return `https://mediaslide-europe.storage.googleapis.com/test/pictures/${modelId}/${categoryId}/large-${Date.now()}-${hash.padEnd(32, '0')}.jpg`;
}

describe('toPreviewModels — bildlimit + dedup + skip-status', () => {
  it('caps portfolio at 20 and reports discarded count', () => {
    const portfolio = Array.from({ length: 30 }, (_, i) =>
      makeUrl(1, 100, `aa${String(i).padStart(2, '0')}`.padEnd(32, 'b')),
    );
    const previews = toPreviewModels([makePayload({ portfolio_image_urls: portfolio })]);
    expect(previews[0].status).toBe('ready');
    expect(previews[0].portfolio_image_urls).toHaveLength(
      PACKAGE_IMPORT_LIMITS.MAX_PORTFOLIO_IMAGES_PER_MODEL,
    );
    expect(previews[0].discardedPortfolio).toBe(
      30 - PACKAGE_IMPORT_LIMITS.MAX_PORTFOLIO_IMAGES_PER_MODEL,
    );
  });

  it('caps polaroids at 10 and reports discarded count', () => {
    const polaroids = Array.from({ length: 12 }, (_, i) =>
      makeUrl(1, 200, `cc${String(i).padStart(2, '0')}`.padEnd(32, 'd')),
    );
    const previews = toPreviewModels([makePayload({ polaroid_image_urls: polaroids })]);
    expect(previews[0].polaroid_image_urls).toHaveLength(
      PACKAGE_IMPORT_LIMITS.MAX_POLAROIDS_PER_MODEL,
    );
    expect(previews[0].discardedPolaroids).toBe(12 - PACKAGE_IMPORT_LIMITS.MAX_POLAROIDS_PER_MODEL);
  });

  it('dedups identical images BEFORE applying the cap', () => {
    const dup = makeUrl(7, 11, 'deadbeef'.padEnd(32, '0'));
    const portfolio = [dup, dup, dup, dup, dup];
    const previews = toPreviewModels([makePayload({ portfolio_image_urls: portfolio })]);
    expect(previews[0].portfolio_image_urls).toEqual([dup]);
    expect(previews[0].discardedPortfolio).toBe(0);
  });

  it('preserves DOM order in deduped output', () => {
    const a = makeUrl(1, 1, '11'.padEnd(32, '0'));
    const b = makeUrl(1, 1, '22'.padEnd(32, '0'));
    const c = makeUrl(1, 1, '33'.padEnd(32, '0'));
    const previews = toPreviewModels([makePayload({ portfolio_image_urls: [a, b, c, a] })]);
    expect(previews[0].portfolio_image_urls).toEqual([a, b, c]);
  });

  it('marks payload missing externalId as skipped', () => {
    const previews = toPreviewModels([makePayload({ externalId: '' })]);
    expect(previews[0].status).toBe('skipped');
    expect(previews[0].skipReason).toBe('missing_external_id');
  });

  it('marks payload missing height as skipped (preserves DB NOT NULL)', () => {
    const previews = toPreviewModels([makePayload({ measurements: { height: null } })]);
    expect(previews[0].status).toBe('skipped');
    expect(previews[0].skipReason).toBe('missing_height');
  });

  it('marks payload missing name as skipped', () => {
    const previews = toPreviewModels([makePayload({ name: '   ' })]);
    expect(previews[0].status).toBe('skipped');
    expect(previews[0].skipReason).toBe('missing_name');
  });

  it('skips ready-eligible model with 0 portfolio + 0 polaroids → no_images', () => {
    const previews = toPreviewModels([
      makePayload({ portfolio_image_urls: [], polaroid_image_urls: [] }),
    ]);
    expect(previews[0].status).toBe('skipped');
    expect(previews[0].skipReason).toBe('no_images');
  });

  it('respects provider-set forceSkipReason regardless of other fields', () => {
    const previews = toPreviewModels([
      makePayload({
        forceSkipReason: 'book_fetch_failed',
        portfolio_image_urls: ['https://x/p1.jpg'],
        polaroid_image_urls: ['https://x/p2.jpg'],
      }),
    ]);
    expect(previews[0].status).toBe('skipped');
    expect(previews[0].skipReason).toBe('book_fetch_failed');
  });

  it('does NOT apply forceSkipReason if externalId is empty (missing_external_id wins)', () => {
    const previews = toPreviewModels([
      makePayload({ externalId: '', forceSkipReason: 'book_fetch_failed' }),
    ]);
    expect(previews[0].status).toBe('skipped');
    expect(previews[0].skipReason).toBe('missing_external_id');
  });
});

describe('previewToImportPayload — mapping correctness', () => {
  it('uses agencyId from caller, NEVER from provider', () => {
    const previews = toPreviewModels([makePayload({ measurements: { height: 180 } })]);
    const payload = previewToImportPayload({
      preview: previews[0],
      agencyId: 'agency-from-caller',
      options: {},
    });
    expect(payload.agency_id).toBe('agency-from-caller');
  });

  it('does NOT populate email/birthday/sex/ethnicity/country_code/territories', () => {
    const previews = toPreviewModels([makePayload({ measurements: { height: 180 } })]);
    const payload = previewToImportPayload({
      preview: previews[0],
      agencyId: 'agency-1',
      options: {},
    });
    expect(payload.email).toBeUndefined();
    expect(payload.birthday).toBeUndefined();
    expect(payload.sex).toBeUndefined();
    expect(payload.ethnicity).toBeUndefined();
    expect(payload.country_code).toBeUndefined();
    expect(payload.territories).toBeUndefined();
  });

  it('passes mediaslide_sync_id when provider is mediaslide', () => {
    const previews = toPreviewModels([
      makePayload({ externalProvider: 'mediaslide', externalId: 'MS-256' }),
    ]);
    const payload = previewToImportPayload({
      preview: previews[0],
      agencyId: 'a-1',
      options: {},
    });
    expect(payload.mediaslide_sync_id).toBe('MS-256');
    expect(payload.netwalk_model_id).toBeUndefined();
  });

  it('passes netwalk_model_id when provider is netwalk', () => {
    const previews = toPreviewModels([
      makePayload({ externalProvider: 'netwalk', externalId: 'NW-77' }),
    ]);
    const payload = previewToImportPayload({
      preview: previews[0],
      agencyId: 'a-1',
      options: {},
    });
    expect(payload.netwalk_model_id).toBe('NW-77');
    expect(payload.mediaslide_sync_id).toBeUndefined();
  });

  it('sets photo_source=mediaslide for mediaslide payloads', () => {
    const previews = toPreviewModels([makePayload({ externalProvider: 'mediaslide' })]);
    const payload = previewToImportPayload({
      preview: previews[0],
      agencyId: 'a-1',
      options: {},
    });
    expect(payload.photo_source).toBe('mediaslide');
  });

  it('sets photo_source=netwalk for netwalk payloads', () => {
    const previews = toPreviewModels([
      makePayload({ externalProvider: 'netwalk', externalId: 'NW-1' }),
    ]);
    const payload = previewToImportPayload({
      preview: previews[0],
      agencyId: 'a-1',
      options: {},
    });
    expect(payload.photo_source).toBe('netwalk');
  });

  it('forwards forceUpdateMeasurements only when option is true', () => {
    const previews = toPreviewModels([makePayload()]);
    const a = previewToImportPayload({ preview: previews[0], agencyId: 'a-1', options: {} });
    expect(a.forceUpdateMeasurements).toBe(false);
    const b = previewToImportPayload({
      preview: previews[0],
      agencyId: 'a-1',
      options: { forceUpdateMeasurements: true },
    });
    expect(b.forceUpdateMeasurements).toBe(true);
  });
});

describe('commitPreview — partial-failure resilience', () => {
  it('continues after a per-model error and reports each outcome', async () => {
    const previews = toPreviewModels([
      makePayload({ externalId: 'A', name: 'A' }),
      makePayload({ externalId: 'B', name: 'B' }),
      makePayload({ externalId: 'C', name: 'C' }),
    ]);

    const calls: ImportModelPayload[] = [];
    const importImpl = jest.fn(async (p: ImportModelPayload) => {
      calls.push(p);
      if (p.mediaslide_sync_id === 'A')
        return { model_id: 'm-A', created: true } as ImportModelAndMergeResult;
      if (p.mediaslide_sync_id === 'B') return null;
      if (p.mediaslide_sync_id === 'C') throw new Error('boom');
      return null;
    });

    const summary = await commitPreview({
      selected: previews,
      agencyId: 'agency-x',
      options: {},
      importImpl,
    });

    expect(calls).toHaveLength(3);
    expect(summary.outcomes).toHaveLength(3);
    expect(summary.outcomes[0]).toMatchObject({ status: 'created', modelId: 'm-A' });
    expect(summary.outcomes[1]).toMatchObject({ status: 'error', reason: 'import_returned_null' });
    expect(summary.outcomes[2]).toMatchObject({
      status: 'error',
      reason: expect.stringContaining('import_threw:boom'),
    });
    expect(summary.createdCount).toBe(1);
    expect(summary.errorCount).toBe(2);
  });

  it('reports merged status when importer returns created=false', async () => {
    const previews = toPreviewModels([makePayload({ externalId: 'X' })]);
    const importImpl = jest.fn(async () => ({
      model_id: 'm-X',
      created: false,
    }));
    const summary = await commitPreview({
      selected: previews,
      agencyId: 'a-1',
      options: {},
      importImpl,
    });
    expect(summary.outcomes[0].status).toBe('merged');
    expect(summary.mergedCount).toBe(1);
  });

  it('reports warning when externalSyncIdsPersistFailed is true', async () => {
    const previews = toPreviewModels([makePayload({ externalId: 'Y' })]);
    const importImpl = jest.fn(async () => ({
      model_id: 'm-Y',
      created: false,
      externalSyncIdsPersistFailed: true,
    }));
    const summary = await commitPreview({
      selected: previews,
      agencyId: 'a-1',
      options: {},
      importImpl,
    });
    expect(summary.outcomes[0]).toMatchObject({
      status: 'warning',
      reason: 'external_sync_ids_persist_failed',
    });
    expect(summary.warningCount).toBe(1);
  });

  it('respects abort signal: remaining models are marked skipped, not imported', async () => {
    const previews = toPreviewModels([
      makePayload({ externalId: '1' }),
      makePayload({ externalId: '2' }),
      makePayload({ externalId: '3' }),
    ]);
    const ctrl = new AbortController();
    const importImpl = jest.fn(async (p: ImportModelPayload) => {
      if (p.mediaslide_sync_id === '1') {
        ctrl.abort();
        return { model_id: 'm-1', created: true };
      }
      return { model_id: 'm-?', created: true };
    });
    const summary = await commitPreview({
      selected: previews,
      agencyId: 'a-1',
      options: {},
      signal: ctrl.signal,
      importImpl,
    });
    expect(importImpl).toHaveBeenCalledTimes(1);
    expect(summary.outcomes.map((o) => o.status)).toEqual(['created', 'skipped', 'skipped']);
    expect(summary.skippedCount).toBe(2);
  });

  it('marks skipped previews as skipped without invoking importer', async () => {
    const previews = toPreviewModels([
      makePayload({ externalId: '' }), // skipped (missing_external_id)
      makePayload({ externalId: 'OK' }),
    ]);
    const importImpl = jest.fn(async () => ({ model_id: 'm-OK', created: true }));
    const summary = await commitPreview({
      selected: previews,
      agencyId: 'a-1',
      options: {},
      importImpl,
    });
    expect(importImpl).toHaveBeenCalledTimes(1);
    expect(summary.outcomes[0].status).toBe('skipped');
    expect(summary.outcomes[1].status).toBe('created');
  });
});
