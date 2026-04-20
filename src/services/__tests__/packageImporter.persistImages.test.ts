/**
 * Hardened smoke tests for the `commitPreview` ↔ `persistImagesForPackageImport`
 * integration (Phase-2 image mirror).
 *
 * These tests exercise:
 *  - The `persistImages: true` path strips external URLs out of the importer
 *    payload (mirror columns are NOT written by the importer; rebuilt by the
 *    persistence module instead).
 *  - The `persistImages: false` (legacy) path keeps the historic behaviour.
 *  - Outcome statuses correctly escalate to `warning` for partial / all-failed
 *    image persistence and accumulate into the summary counts.
 *  - The persistence module is invoked with the modelId returned by the
 *    importer (no cross-model leak via construction).
 *  - A throwing persistence implementation downgrades to `warning` rather than
 *    bubbling up and failing the whole batch.
 *  - Sync-id-persist warning + image partial failure are reported together
 *    (no information loss, status is `warning` exactly once in the count).
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('../territoriesSupabase', () => ({
  upsertTerritoriesForModelCountryAgencyPairs: jest.fn().mockResolvedValue([]),
}));

import { commitPreview, toPreviewModels } from '../packageImporter';
import { type ProviderImportPayload } from '../packageImportTypes';
import type { ImportModelAndMergeResult, ImportModelPayload } from '../modelsImportSupabase';
import type {
  PackageImagePersistResult,
  PersistImagesForModelInput,
} from '../packageImagePersistence';

function payload(overrides: Partial<ProviderImportPayload> = {}): ProviderImportPayload {
  return {
    externalProvider: 'mediaslide',
    externalId: 'MS-1',
    name: 'Test Model',
    measurements: { height: 180 },
    portfolio_image_urls: ['https://cdn.example.test/p/1.jpg', 'https://cdn.example.test/p/2.jpg'],
    polaroid_image_urls: ['https://cdn.example.test/q/1.jpg'],
    ...overrides,
  };
}

function ok(modelId = 'm-1', created = true): ImportModelAndMergeResult {
  return { model_id: modelId, created } as ImportModelAndMergeResult;
}

function persistResult(p: Partial<PackageImagePersistResult>): PackageImagePersistResult {
  return {
    portfolioPersisted: 0,
    portfolioAttempted: 0,
    polaroidPersisted: 0,
    polaroidAttempted: 0,
    failures: [],
    mirrorRebuilt: true,
    ...p,
  };
}

// ---------------------------------------------------------------------------
// 1) Mirror-column protection — external URLs never leak into the DB importer
// ---------------------------------------------------------------------------

describe('commitPreview — persistImages:true strips external URLs from importer payload', () => {
  it('importer receives portfolio_images=null and polaroids=null when persistImages is on', async () => {
    const previews = toPreviewModels([payload()]);
    const captured: ImportModelPayload[] = [];
    const importImpl = jest.fn(async (p: ImportModelPayload) => {
      captured.push(p);
      return ok();
    });
    const persistImagesImpl = jest.fn(async (_input: PersistImagesForModelInput) =>
      persistResult({
        portfolioPersisted: 2,
        portfolioAttempted: 2,
        polaroidPersisted: 1,
        polaroidAttempted: 1,
      }),
    );

    await commitPreview({
      selected: previews,
      agencyId: 'a',
      options: { persistImages: true },
      importImpl,
      persistImagesImpl,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].portfolio_images).toBeNull();
    expect(captured[0].polaroids).toBeNull();
  });

  it('persistImages:false → importer receives the original URL arrays (legacy)', async () => {
    const previews = toPreviewModels([payload()]);
    const captured: ImportModelPayload[] = [];
    const importImpl = jest.fn(async (p: ImportModelPayload) => {
      captured.push(p);
      return ok();
    });

    await commitPreview({
      selected: previews,
      agencyId: 'a',
      options: { persistImages: false },
      importImpl,
    });

    expect(captured[0].portfolio_images).toEqual([
      'https://cdn.example.test/p/1.jpg',
      'https://cdn.example.test/p/2.jpg',
    ]);
    expect(captured[0].polaroids).toEqual(['https://cdn.example.test/q/1.jpg']);
  });

  it('persistImages omitted defaults to false (legacy) — old tests stay green', async () => {
    const previews = toPreviewModels([payload()]);
    const captured: ImportModelPayload[] = [];
    const importImpl = jest.fn(async (p: ImportModelPayload) => {
      captured.push(p);
      return ok();
    });
    await commitPreview({
      selected: previews,
      agencyId: 'a',
      options: {},
      importImpl,
    });
    expect(captured[0].portfolio_images).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2) Persistence is called with the modelId from the importer (no leak)
// ---------------------------------------------------------------------------

describe('commitPreview — persistence uses importer-returned modelId', () => {
  it('passes res.model_id (NOT externalId) into persistImagesForPackageImport', async () => {
    const previews = toPreviewModels([
      payload({ externalId: 'MS-A' }),
      payload({ externalId: 'MS-B', name: 'Other' }),
    ]);
    const persistCalls: PersistImagesForModelInput[] = [];
    const importImpl = jest.fn(async (p: ImportModelPayload) =>
      ok(p.mediaslide_sync_id === 'MS-A' ? 'db-A' : 'db-B'),
    );
    const persistImagesImpl = jest.fn(async (input: PersistImagesForModelInput) => {
      persistCalls.push(input);
      return persistResult({
        portfolioPersisted: input.portfolioUrls.length,
        portfolioAttempted: input.portfolioUrls.length,
        polaroidPersisted: input.polaroidUrls.length,
        polaroidAttempted: input.polaroidUrls.length,
      });
    });

    await commitPreview({
      selected: previews,
      agencyId: 'a',
      options: { persistImages: true },
      importImpl,
      persistImagesImpl,
    });

    expect(persistCalls.map((c) => c.modelId)).toEqual(['db-A', 'db-B']);
    expect(persistCalls[0].providerExternalId).toBe('MS-A');
    expect(persistCalls[1].providerExternalId).toBe('MS-B');
    expect(persistCalls.every((c) => c.provider === 'mediaslide')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3) Outcome escalation: partial / all-failed / mirror_rebuild_failed
// ---------------------------------------------------------------------------

describe('commitPreview — outcome escalation from image persistence', () => {
  it('partial image persistence escalates to warning + reports counts', async () => {
    const previews = toPreviewModels([payload()]);
    const importImpl = jest.fn(async () => ok('m-1', true));
    const persistImagesImpl = jest.fn(async () =>
      persistResult({
        portfolioPersisted: 1,
        portfolioAttempted: 2,
        polaroidPersisted: 1,
        polaroidAttempted: 1,
        failures: [{ index: 1, type: 'portfolio', maskedUrl: '…', reason: 'download_http_error' }],
      }),
    );

    const summary = await commitPreview({
      selected: previews,
      agencyId: 'a',
      options: { persistImages: true },
      importImpl,
      persistImagesImpl,
    });

    expect(summary.createdCount).toBe(0);
    expect(summary.warningCount).toBe(1);
    expect(summary.outcomes[0]).toMatchObject({
      status: 'warning',
      modelId: 'm-1',
      imagesPersisted: 2,
      imagesAttempted: 3,
    });
    expect(summary.outcomes[0].reason).toMatch(/images_partial:2\/3/);
    expect(summary.outcomes[0].imageFailureReasons).toContain('portfolio#1:download_http_error');
  });

  it('all_failed image persistence (with attempted>0) escalates to warning', async () => {
    const previews = toPreviewModels([payload()]);
    const importImpl = jest.fn(async () => ok());
    const persistImagesImpl = jest.fn(async () =>
      persistResult({
        portfolioPersisted: 0,
        portfolioAttempted: 2,
        polaroidPersisted: 0,
        polaroidAttempted: 1,
        failures: [
          { index: 0, type: 'portfolio', maskedUrl: '…', reason: 'download_http_error' },
          { index: 1, type: 'portfolio', maskedUrl: '…', reason: 'download_http_error' },
          { index: 0, type: 'polaroid', maskedUrl: '…', reason: 'download_http_error' },
        ],
      }),
    );

    const summary = await commitPreview({
      selected: previews,
      agencyId: 'a',
      options: { persistImages: true },
      importImpl,
      persistImagesImpl,
    });

    expect(summary.createdCount).toBe(0);
    expect(summary.warningCount).toBe(1);
    expect(summary.outcomes[0].status).toBe('warning');
    expect(summary.outcomes[0].reason).toMatch(/all_images_persistence_failed/);
  });

  it('all_ok image persistence keeps status=created and increments createdCount', async () => {
    const previews = toPreviewModels([payload()]);
    const importImpl = jest.fn(async () => ok());
    const persistImagesImpl = jest.fn(async () =>
      persistResult({
        portfolioPersisted: 2,
        portfolioAttempted: 2,
        polaroidPersisted: 1,
        polaroidAttempted: 1,
      }),
    );

    const summary = await commitPreview({
      selected: previews,
      agencyId: 'a',
      options: { persistImages: true },
      importImpl,
      persistImagesImpl,
    });

    expect(summary.createdCount).toBe(1);
    expect(summary.warningCount).toBe(0);
    expect(summary.outcomes[0].status).toBe('created');
    expect(summary.outcomes[0].imagesPersisted).toBe(3);
    expect(summary.outcomes[0].imagesAttempted).toBe(3);
  });

  it('mirrorRebuilt:false escalates to warning even when all images persisted', async () => {
    const previews = toPreviewModels([payload()]);
    const importImpl = jest.fn(async () => ok());
    const persistImagesImpl = jest.fn(async () =>
      persistResult({
        portfolioPersisted: 2,
        portfolioAttempted: 2,
        polaroidPersisted: 1,
        polaroidAttempted: 1,
        mirrorRebuilt: false,
      }),
    );

    const summary = await commitPreview({
      selected: previews,
      agencyId: 'a',
      options: { persistImages: true },
      importImpl,
      persistImagesImpl,
    });

    expect(summary.warningCount).toBe(1);
    expect(summary.outcomes[0].status).toBe('warning');
    expect(summary.outcomes[0].reason).toMatch(/mirror_rebuild_failed/);
  });

  it('persistence throwing escalates to warning (does NOT crash the batch)', async () => {
    const previews = toPreviewModels([payload(), payload({ externalId: 'MS-2', name: 'Two' })]);
    const importImpl = jest.fn(async (p: ImportModelPayload) => ok(`db-${p.mediaslide_sync_id}`));
    const persistImagesImpl = jest.fn(async (input: PersistImagesForModelInput) => {
      if (input.providerExternalId === 'MS-1') throw new Error('rls_denied');
      return persistResult({
        portfolioPersisted: input.portfolioUrls.length,
        portfolioAttempted: input.portfolioUrls.length,
        polaroidPersisted: input.polaroidUrls.length,
        polaroidAttempted: input.polaroidUrls.length,
      });
    });

    const summary = await commitPreview({
      selected: previews,
      agencyId: 'a',
      options: { persistImages: true },
      importImpl,
      persistImagesImpl,
    });

    expect(summary.outcomes[0].status).toBe('warning');
    expect(summary.outcomes[0].reason).toMatch(/image_persistence_threw:rls_denied/);
    expect(summary.outcomes[1].status).toBe('created');
    expect(summary.warningCount).toBe(1);
    expect(summary.createdCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4) Combination: sync-id-persist warning + partial images
// ---------------------------------------------------------------------------

describe('commitPreview — combined warnings (sync ids + image persistence)', () => {
  it('keeps status=warning and combines reasons; warning is counted exactly once', async () => {
    const previews = toPreviewModels([payload()]);
    const importImpl = jest.fn(async () => ({
      model_id: 'm-1',
      created: false,
      externalSyncIdsPersistFailed: true,
    }));
    const persistImagesImpl = jest.fn(async () =>
      persistResult({
        portfolioPersisted: 1,
        portfolioAttempted: 2,
        polaroidPersisted: 0,
        polaroidAttempted: 1,
        failures: [
          { index: 1, type: 'portfolio', maskedUrl: '…', reason: 'download_http_error' },
          { index: 0, type: 'polaroid', maskedUrl: '…', reason: 'invalid_content_type' },
        ],
      }),
    );

    const summary = await commitPreview({
      selected: previews,
      agencyId: 'a',
      options: { persistImages: true },
      importImpl,
      persistImagesImpl,
    });

    expect(summary.warningCount).toBe(1);
    expect(summary.mergedCount).toBe(0);
    expect(summary.outcomes[0].status).toBe('warning');
    expect(summary.outcomes[0].reason).toMatch(/external_sync_ids_persist_failed/);
    expect(summary.outcomes[0].reason).toMatch(/images_partial:1\/3/);
  });
});

// ---------------------------------------------------------------------------
// 5) Skipped models do NOT trigger persistence
// ---------------------------------------------------------------------------

describe('commitPreview — persistence is NOT called for skipped models', () => {
  it('forceSkipReason → persistImagesImpl never invoked', async () => {
    const previews = toPreviewModels([payload({ forceSkipReason: 'book_fetch_failed' })]);
    const importImpl = jest.fn();
    const persistImagesImpl = jest.fn(async () => persistResult({}));

    await commitPreview({
      selected: previews,
      agencyId: 'a',
      options: { persistImages: true },
      importImpl: importImpl as unknown as (
        p: ImportModelPayload,
      ) => Promise<ImportModelAndMergeResult | null>,
      persistImagesImpl,
    });

    expect(importImpl).not.toHaveBeenCalled();
    expect(persistImagesImpl).not.toHaveBeenCalled();
  });

  it('importer error → persistImagesImpl never invoked for that model', async () => {
    const previews = toPreviewModels([payload(), payload({ externalId: 'MS-2', name: 'Two' })]);
    const importImpl = jest.fn(async (p: ImportModelPayload) => {
      if (p.mediaslide_sync_id === 'MS-1') throw new Error('rls_denied');
      return ok('db-2');
    });
    const persistImagesImpl = jest.fn(async (_input: PersistImagesForModelInput) =>
      persistResult({
        portfolioPersisted: 2,
        portfolioAttempted: 2,
      }),
    );

    const summary = await commitPreview({
      selected: previews,
      agencyId: 'a',
      options: { persistImages: true },
      importImpl,
      persistImagesImpl,
    });

    expect(persistImagesImpl).toHaveBeenCalledTimes(1);
    const persistCall = (persistImagesImpl.mock.calls[0] as [PersistImagesForModelInput])[0];
    expect(persistCall.modelId).toBe('db-2');
    expect(summary.errorCount).toBe(1);
    expect(summary.createdCount).toBe(1);
  });
});
