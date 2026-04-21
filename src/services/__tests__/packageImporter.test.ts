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

  // -------------------------------------------------------------------------
  // Territory forwarding (MAT visibility fix)
  // -------------------------------------------------------------------------
  //
  // Without these, an imported model is created in `models` but stays
  // INVISIBLE in "My Models" because the roster query
  // (`getModelsForAgencyFromSupabase`) is fail-closed on
  // `model_agency_territories`. The UI now requires at least one ISO-2 code
  // and forwards it through `previewToImportPayload`, which in turn forwards
  // it to `importModelAndMerge` for both the create and the merge path.
  // -------------------------------------------------------------------------

  it('forwards territories from CommitOptions, normalises country codes to UPPERCASE', () => {
    const previews = toPreviewModels([makePayload()]);
    const payload = previewToImportPayload({
      preview: previews[0],
      agencyId: 'agency-1',
      options: {
        territories: [
          { country_code: 'at', agency_id: 'agency-1' },
          { country_code: 'de', agency_id: 'agency-1' },
        ],
      },
    });
    expect(payload.territories).toEqual([
      { country_code: 'AT', agency_id: 'agency-1' },
      { country_code: 'DE', agency_id: 'agency-1' },
    ]);
  });

  it('OVERRIDES any incoming territory.agency_id with the agencyId of the call (defense-in-depth)', () => {
    // Even if a malicious / buggy caller passes a foreign agency_id alongside
    // a country code, the resulting territory MUST belong to the calling
    // agency — otherwise the import would inject claims into a foreign
    // agency's roster, which RLS shouldn't allow but we don't want to depend
    // on RLS for this safety property.
    const previews = toPreviewModels([makePayload()]);
    const payload = previewToImportPayload({
      preview: previews[0],
      agencyId: 'caller-agency',
      options: {
        territories: [{ country_code: 'AT', agency_id: 'foreign-agency-DO-NOT-USE' }],
      },
    });
    expect(payload.territories).toEqual([{ country_code: 'AT', agency_id: 'caller-agency' }]);
  });

  it('drops territories with empty country_code without crashing', () => {
    const previews = toPreviewModels([makePayload()]);
    const payload = previewToImportPayload({
      preview: previews[0],
      agencyId: 'agency-1',
      options: {
        territories: [
          { country_code: '', agency_id: 'agency-1' },
          { country_code: '   ', agency_id: 'agency-1' },
          { country_code: 'GB', agency_id: 'agency-1' },
        ],
      },
    });
    expect(payload.territories).toEqual([{ country_code: 'GB', agency_id: 'agency-1' }]);
  });

  it('omits the territories field entirely when no claims are provided (legacy / Native)', () => {
    const previews = toPreviewModels([makePayload()]);
    const a = previewToImportPayload({ preview: previews[0], agencyId: 'a-1', options: {} });
    expect(a.territories).toBeUndefined();
    const b = previewToImportPayload({
      preview: previews[0],
      agencyId: 'a-1',
      options: { territories: [] },
    });
    expect(b.territories).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Per-row territory override
  // -------------------------------------------------------------------------
  it('per-row territoriesByExternalId overrides the global territories list', () => {
    const previews = toPreviewModels([
      makePayload({ externalId: 'X1', name: 'X1' }),
      makePayload({ externalId: 'X2', name: 'X2' }),
    ]);
    const globalT = [{ country_code: 'AT', agency_id: 'agency-1' }];
    const perRow: Record<string, { country_code: string; agency_id: string }[]> = {
      X2: [
        { country_code: 'gb', agency_id: 'agency-1' },
        { country_code: 'fr', agency_id: 'agency-1' },
      ],
    };
    const p1 = previewToImportPayload({
      preview: previews[0],
      agencyId: 'agency-1',
      options: { territories: globalT, territoriesByExternalId: perRow },
    });
    const p2 = previewToImportPayload({
      preview: previews[1],
      agencyId: 'agency-1',
      options: { territories: globalT, territoriesByExternalId: perRow },
    });
    expect(p1.territories).toEqual([{ country_code: 'AT', agency_id: 'agency-1' }]);
    expect(p2.territories).toEqual([
      { country_code: 'GB', agency_id: 'agency-1' },
      { country_code: 'FR', agency_id: 'agency-1' },
    ]);
  });

  it('per-row override also gets agency_id hard-overridden (defense-in-depth)', () => {
    const previews = toPreviewModels([makePayload({ externalId: 'X', name: 'X' })]);
    const payload = previewToImportPayload({
      preview: previews[0],
      agencyId: 'caller-agency',
      options: {
        territoriesByExternalId: {
          X: [{ country_code: 'AT', agency_id: 'foreign-DO-NOT-USE' }],
        },
      },
    });
    expect(payload.territories).toEqual([{ country_code: 'AT', agency_id: 'caller-agency' }]);
  });

  it('falls back to global territories when per-row entry is empty array', () => {
    const previews = toPreviewModels([makePayload({ externalId: 'X', name: 'X' })]);
    const payload = previewToImportPayload({
      preview: previews[0],
      agencyId: 'agency-1',
      options: {
        territories: [{ country_code: 'AT', agency_id: 'agency-1' }],
        territoriesByExternalId: { X: [] },
      },
    });
    expect(payload.territories).toEqual([{ country_code: 'AT', agency_id: 'agency-1' }]);
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

// ---------------------------------------------------------------------------
// commitPreview — defense-in-depth MAX_MODELS_PER_RUN guard
// ---------------------------------------------------------------------------

describe('commitPreview — MAX_MODELS_PER_RUN cap', () => {
  it('throws when selected length exceeds the hard cap (defense against future non-UI callers)', async () => {
    // The Analyze-phase UI already blocks at 100, but a CLI / RPC / scripted
    // re-commit path could bypass it. Without the importer-side guard a
    // 1000-model loop would (a) block the agency thread for 30+ minutes,
    // (b) saturate the storage upload queue, (c) generate enough Edge
    // Function calls to risk a per-JWT rate trip.
    const previews = Array.from({ length: PACKAGE_IMPORT_LIMITS.MAX_MODELS_PER_RUN + 1 }, (_, i) =>
      makePayload({ externalId: `M-${i}`, name: `Model ${i}` }),
    );
    const builtPreviews = toPreviewModels(previews);
    const importImpl = jest.fn();

    await expect(
      commitPreview({
        selected: builtPreviews,
        agencyId: 'agency-X',
        options: {},
        importImpl,
      }),
    ).rejects.toThrow(/MAX_MODELS_PER_RUN=100/);
    expect(importImpl).not.toHaveBeenCalled();
  });

  it('accepts exactly MAX_MODELS_PER_RUN selected models (boundary is inclusive)', async () => {
    const previews = Array.from({ length: PACKAGE_IMPORT_LIMITS.MAX_MODELS_PER_RUN }, (_, i) =>
      makePayload({ externalId: `M-${i}`, name: `M${i}` }),
    );
    const builtPreviews = toPreviewModels(previews);
    const importImpl = jest.fn(async () => ({ model_id: 'mx', created: true }));
    const summary = await commitPreview({
      selected: builtPreviews,
      agencyId: 'a',
      options: {},
      importImpl,
    });
    expect(summary.outcomes).toHaveLength(PACKAGE_IMPORT_LIMITS.MAX_MODELS_PER_RUN);
    expect(importImpl).toHaveBeenCalledTimes(PACKAGE_IMPORT_LIMITS.MAX_MODELS_PER_RUN);
  });
});

// ---------------------------------------------------------------------------
// commitPreview — progress throttling
// ---------------------------------------------------------------------------

describe('commitPreview — onProgress throttling', () => {
  it('forces a fresh emit at every model boundary even if throttled', async () => {
    // The agency needs to see "Importing 5/10 — Rémi" the moment a new model
    // starts; throttling per-image emits is fine but per-model emits MUST be
    // immediate, otherwise the progress bar visibly stalls.
    const previews = toPreviewModels([
      makePayload({ externalId: '1', name: 'One' }),
      makePayload({ externalId: '2', name: 'Two' }),
      makePayload({ externalId: '3', name: 'Three' }),
    ]);
    const importImpl = jest.fn(async () => ({ model_id: 'm', created: true }));
    const seenLabels: Array<string | undefined> = [];
    const onProgress = jest.fn((p: { currentLabel?: string }) => {
      seenLabels.push(p.currentLabel);
    });

    await commitPreview({
      selected: previews,
      agencyId: 'a',
      options: {},
      importImpl,
      onProgress,
    });

    // Three model-start emits + final done emit (no label) = at least 4 emits,
    // and each model name must appear in the label stream.
    expect(seenLabels.filter((l) => l === 'One')).toHaveLength(1);
    expect(seenLabels.filter((l) => l === 'Two')).toHaveLength(1);
    expect(seenLabels.filter((l) => l === 'Three')).toHaveLength(1);
    // Final emit has no label → done=total signal for the UI to flip to done.
    expect(seenLabels[seenLabels.length - 1]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// previewToImportPayload — forceUpdateAppearance forwarding
// ---------------------------------------------------------------------------

describe('previewToImportPayload — forceUpdateAppearance', () => {
  it('forwards forceUpdateAppearance:true into the importer payload', () => {
    const previews = toPreviewModels([makePayload({ externalId: 'A', name: 'A' })]);
    const payload = previewToImportPayload({
      preview: previews[0],
      agencyId: 'a',
      options: { forceUpdateAppearance: true },
    });
    expect(payload.forceUpdateAppearance).toBe(true);
  });

  it('defaults forceUpdateAppearance to false when not set (existing values protected)', () => {
    const previews = toPreviewModels([makePayload({ externalId: 'A', name: 'A' })]);
    const payload = previewToImportPayload({
      preview: previews[0],
      agencyId: 'a',
      options: {},
    });
    expect(payload.forceUpdateAppearance).toBe(false);
  });

  it('forceUpdateAppearance is independent from forceUpdateMeasurements', () => {
    const previews = toPreviewModels([makePayload({ externalId: 'A', name: 'A' })]);
    const payload = previewToImportPayload({
      preview: previews[0],
      agencyId: 'a',
      options: { forceUpdateAppearance: true, forceUpdateMeasurements: false },
    });
    expect(payload.forceUpdateAppearance).toBe(true);
    expect(payload.forceUpdateMeasurements).toBe(false);
  });
});
