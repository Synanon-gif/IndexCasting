/**
 * MediaSlide Package Provider — adversarial smoke tests.
 *
 * Real-world hostile cases:
 *   - 3 cards, mixed broken/good
 *   - 1 card with healthy book + 1 album fetch 500
 *   - 1 card whose book completely 500s (forceSkipReason path)
 *   - empty list (drift hard_block)
 *   - cross-card image isolation (model 1's images do NOT leak into model 2)
 *   - Polaroids and Portfolio routing for the same model
 *   - Album-fetch concurrency does not corrupt per-model image maps
 *
 * No real HTTP. We inject a deterministic mock fetcher that returns synthetic
 * HTML keyed by category id.
 */

import { createMediaslidePackageProvider } from '../mediaslidePackageProvider';
import type { MediaslideFetcher } from '../mediaslidePackageFetcher';
import { isParserDriftError, type ProviderImportPayload } from '../packageImportTypes';

const VALID_URL = 'https://hausofhay.mediaslide.com/package/view/176/1a5f30ca/331/2a9fa1ab';

function gcsUrl(modelId: number, categoryId: number, hash: string): string {
  return `https://mediaslide-europe.storage.googleapis.com/test/pictures/${modelId}/${categoryId}/large-1700000000-${hash.padEnd(32, '0').slice(0, 32)}.jpg`;
}

function syntheticListHtml(opts: {
  cards: Array<{
    packageId: number;
    modelId: number;
    name: string;
    bookId: number;
    height?: number;
  }>;
}): string {
  const cards = opts.cards.map((c) => {
    const heightPart = c.height != null ? `<div class="modelHeight">${c.height}cm</div>` : '';
    return `
      <div id="packageModel_${c.packageId}" class="packageModel">
        <a href="#book-${c.bookId}"><img data-original="${gcsUrl(c.modelId, c.bookId, `cv${c.modelId}`)}" /></a>
        <div class="modelName" translate="no">${c.name}</div>
        <a id="select_${c.modelId}" data-model-id="${c.modelId}"></a>
        ${heightPart}
      </div>
    `;
  });
  return `<html><body>${cards.join('\n')}</body></html>`;
}

function syntheticBookHtml(opts: {
  modelName: string;
  height: number;
  chest?: number;
  waist?: number;
  hips?: number;
  /** [{ categoryId, title, count, images }] — built from the model's perspective. */
  albums: Array<{ categoryId: string; title: string; count: number }>;
  /** Bilder die beim aktuellen Book-Fetch zurückgegeben werden (für die aufgerufene categoryId). */
  imagesForThisCategory: string[];
}): string {
  const albumLinks = opts.albums
    .map(
      (a) =>
        `<a href="#book-${a.categoryId}"><span class="menuUnselected">${a.title} <span class="albumCounter">(${a.count})</span></span></a>`,
    )
    .join('');
  const measurementBlocks = [
    `<div class="measurementElement"><span class="measurementTitle">Height</span> <span class="measurementEu">${opts.height}<span class="measurementUnit">cm</span></span></div>`,
    opts.chest != null
      ? `<div class="measurementElement"><span class="measurementTitle">Chest</span> <span class="measurementEu">${opts.chest}<span class="measurementUnit">cm</span></span></div>`
      : '',
    opts.waist != null
      ? `<div class="measurementElement"><span class="measurementTitle">Waist</span> <span class="measurementEu">${opts.waist}<span class="measurementUnit">cm</span></span></div>`
      : '',
    opts.hips != null
      ? `<div class="measurementElement"><span class="measurementTitle">Hips</span> <span class="measurementEu">${opts.hips}<span class="measurementUnit">cm</span></span></div>`
      : '',
  ].join('');
  const pictures = opts.imagesForThisCategory
    .map((url) => `<div class="modelBookPicture"><img class="portrait" data-lazy="${url}" /></div>`)
    .join('');
  return `
    <div class="bookMenuName" translate="no">${opts.modelName}</div>
    <div class="bookMenuLinks">${albumLinks}</div>
    <div id="bookModelMeasurements">${measurementBlocks}</div>
    ${pictures}
  `;
}

// ---------------------------------------------------------------------------
// 1) 3-card mixed batch end-to-end
// ---------------------------------------------------------------------------

describe('mediaslidePackageProvider — 3-card cross-model isolation', () => {
  it('three healthy models keep their measurements, names and images strictly disjoint', async () => {
    const listHtml = syntheticListHtml({
      cards: [
        { packageId: 11, modelId: 1, name: 'ALICE A', bookId: 100, height: 175 },
        { packageId: 22, modelId: 2, name: 'BOB B', bookId: 200, height: 188 },
        { packageId: 33, modelId: 3, name: 'CARL C', bookId: 300, height: 172 },
      ],
    });

    // Per model: a default category (Portfolio) + a polaroids category.
    // Each model has DISTINCT images so cross-contamination would be obvious.
    const bookByCategory: Record<string, string> = {
      '100': syntheticBookHtml({
        modelName: 'ALICE A',
        height: 175,
        chest: 90,
        waist: 70,
        hips: 92,
        albums: [
          { categoryId: '100', title: 'PORTFOLIO', count: 2 },
          { categoryId: '101', title: 'POLAROIDS', count: 1 },
        ],
        imagesForThisCategory: [gcsUrl(1, 100, 'a01'), gcsUrl(1, 100, 'a02')],
      }),
      '101': syntheticBookHtml({
        modelName: 'ALICE A',
        height: 175,
        albums: [
          { categoryId: '100', title: 'PORTFOLIO', count: 2 },
          { categoryId: '101', title: 'POLAROIDS', count: 1 },
        ],
        imagesForThisCategory: [gcsUrl(1, 101, 'apol1')],
      }),
      '200': syntheticBookHtml({
        modelName: 'BOB B',
        height: 188,
        chest: 95,
        waist: 78,
        hips: 96,
        albums: [
          { categoryId: '200', title: 'PORTFOLIO', count: 1 },
          { categoryId: '201', title: 'POLAROIDS', count: 1 },
        ],
        imagesForThisCategory: [gcsUrl(2, 200, 'b01')],
      }),
      '201': syntheticBookHtml({
        modelName: 'BOB B',
        height: 188,
        albums: [
          { categoryId: '200', title: 'PORTFOLIO', count: 1 },
          { categoryId: '201', title: 'POLAROIDS', count: 1 },
        ],
        imagesForThisCategory: [gcsUrl(2, 201, 'bpol1')],
      }),
      '300': syntheticBookHtml({
        modelName: 'CARL C',
        height: 172,
        chest: 88,
        waist: 68,
        hips: 88,
        albums: [{ categoryId: '300', title: 'PORTFOLIO', count: 3 }],
        imagesForThisCategory: [
          gcsUrl(3, 300, 'c01'),
          gcsUrl(3, 300, 'c02'),
          gcsUrl(3, 300, 'c03'),
        ],
      }),
    };

    const fetcher: MediaslideFetcher = {
      fetchPackageListHtml: jest.fn(async () => listHtml),
      fetchPackageBookFragment: jest.fn(async ({ modelPictureCategoryId }) => {
        const html = bookByCategory[modelPictureCategoryId];
        if (!html) throw new Error('package_http_error:404');
        return html;
      }),
    };

    const provider = createMediaslidePackageProvider({ fetcher });
    const payloads = await provider.analyze({ url: VALID_URL });

    expect(payloads).toHaveLength(3);
    const byId = Object.fromEntries(
      payloads.map((p): [string, ProviderImportPayload] => [p.externalId, p]),
    );

    expect(byId['1'].name).toBe('ALICE A');
    expect(byId['1'].measurements.height).toBe(175);
    expect(byId['1'].measurements.chest).toBe(90);
    expect(byId['1'].portfolio_image_urls).toEqual([gcsUrl(1, 100, 'a01'), gcsUrl(1, 100, 'a02')]);
    expect(byId['1'].polaroid_image_urls).toEqual([gcsUrl(1, 101, 'apol1')]);

    expect(byId['2'].name).toBe('BOB B');
    expect(byId['2'].measurements.height).toBe(188);
    expect(byId['2'].portfolio_image_urls).toEqual([gcsUrl(2, 200, 'b01')]);
    expect(byId['2'].polaroid_image_urls).toEqual([gcsUrl(2, 201, 'bpol1')]);

    expect(byId['3'].name).toBe('CARL C');
    expect(byId['3'].measurements.height).toBe(172);
    expect(byId['3'].portfolio_image_urls).toHaveLength(3);
    expect(byId['3'].polaroid_image_urls).toEqual([]);

    // Strong isolation check: NO overlap between any two models' image arrays.
    for (const id of ['1', '2', '3']) {
      for (const otherId of ['1', '2', '3']) {
        if (id === otherId) continue;
        for (const url of byId[id].portfolio_image_urls) {
          expect(byId[otherId].portfolio_image_urls).not.toContain(url);
          expect(byId[otherId].polaroid_image_urls).not.toContain(url);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2) Polaroids vs Portfolio classification (English + German)
// ---------------------------------------------------------------------------

describe('mediaslidePackageProvider — album classification', () => {
  it('classifies "POLAROIDS" album to polaroid_image_urls (not portfolio)', async () => {
    const listHtml = syntheticListHtml({
      cards: [{ packageId: 99, modelId: 99, name: 'POLA TEST', bookId: 900, height: 180 }],
    });
    const fetcher: MediaslideFetcher = {
      fetchPackageListHtml: jest.fn(async () => listHtml),
      fetchPackageBookFragment: jest.fn(async ({ modelPictureCategoryId }) => {
        if (modelPictureCategoryId === '900')
          return syntheticBookHtml({
            modelName: 'POLA TEST',
            height: 180,
            albums: [
              { categoryId: '900', title: 'PORTFOLIO', count: 1 },
              { categoryId: '901', title: 'POLAROIDS', count: 1 },
            ],
            imagesForThisCategory: [gcsUrl(99, 900, 'port01')],
          });
        if (modelPictureCategoryId === '901')
          return syntheticBookHtml({
            modelName: 'POLA TEST',
            height: 180,
            albums: [
              { categoryId: '900', title: 'PORTFOLIO', count: 1 },
              { categoryId: '901', title: 'POLAROIDS', count: 1 },
            ],
            imagesForThisCategory: [gcsUrl(99, 901, 'pola01')],
          });
        throw new Error('package_http_error:404');
      }),
    };
    const provider = createMediaslidePackageProvider({ fetcher });
    const [p] = await provider.analyze({ url: VALID_URL });
    expect(p.portfolio_image_urls).toEqual([gcsUrl(99, 900, 'port01')]);
    expect(p.polaroid_image_urls).toEqual([gcsUrl(99, 901, 'pola01')]);
  });

  it('non-portfolio / non-polaroid albums (DIGITALS) land in extra_album_counts only', async () => {
    const listHtml = syntheticListHtml({
      cards: [{ packageId: 7, modelId: 7, name: 'EXTRA', bookId: 700, height: 170 }],
    });
    const fetcher: MediaslideFetcher = {
      fetchPackageListHtml: jest.fn(async () => listHtml),
      fetchPackageBookFragment: jest.fn(async ({ modelPictureCategoryId }) => {
        if (modelPictureCategoryId === '700')
          return syntheticBookHtml({
            modelName: 'EXTRA',
            height: 170,
            albums: [
              { categoryId: '700', title: 'PORTFOLIO', count: 1 },
              { categoryId: '701', title: 'DIGITALS', count: 6 },
            ],
            imagesForThisCategory: [gcsUrl(7, 700, 'ex01')],
          });
        if (modelPictureCategoryId === '701')
          return syntheticBookHtml({
            modelName: 'EXTRA',
            height: 170,
            albums: [
              { categoryId: '700', title: 'PORTFOLIO', count: 1 },
              { categoryId: '701', title: 'DIGITALS', count: 6 },
            ],
            imagesForThisCategory: Array.from({ length: 6 }, (_, i) => gcsUrl(7, 701, `dg${i}`)),
          });
        throw new Error('package_http_error:404');
      }),
    };
    const provider = createMediaslidePackageProvider({ fetcher });
    const [p] = await provider.analyze({ url: VALID_URL });
    expect(p.portfolio_image_urls).toHaveLength(1);
    expect(p.polaroid_image_urls).toEqual([]);
    expect(p.extra_album_counts?.['DIGITALS']).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// 3) Hostile failure modes (catastrophic vs partial book failures)
// ---------------------------------------------------------------------------

describe('mediaslidePackageProvider — partial vs catastrophic book failures', () => {
  it('a single 500 on the polaroids album → portfolio kept, polaroids empty + warning', async () => {
    const listHtml = syntheticListHtml({
      cards: [{ packageId: 1, modelId: 1, name: 'PARTIAL', bookId: 10, height: 170 }],
    });
    const fetcher: MediaslideFetcher = {
      fetchPackageListHtml: jest.fn(async () => listHtml),
      fetchPackageBookFragment: jest.fn(async ({ modelPictureCategoryId }) => {
        if (modelPictureCategoryId === '10')
          return syntheticBookHtml({
            modelName: 'PARTIAL',
            height: 170,
            albums: [
              { categoryId: '10', title: 'PORTFOLIO', count: 1 },
              { categoryId: '11', title: 'POLAROIDS', count: 1 },
            ],
            imagesForThisCategory: [gcsUrl(1, 10, 'p01')],
          });
        throw new Error('package_http_error:500');
      }),
    };
    const provider = createMediaslidePackageProvider({ fetcher });
    const [p] = await provider.analyze({ url: VALID_URL });
    expect(p.forceSkipReason).toBeUndefined();
    expect(p.portfolio_image_urls).toHaveLength(1);
    expect(p.polaroid_image_urls).toEqual([]);
    expect(p.warnings ?? []).toEqual(
      expect.arrayContaining([expect.stringMatching(/album_fetch_failed:POLAROIDS/)]),
    );
  });

  it('default-album fetch fails completely → drift hard_block (which is the right safety net)', async () => {
    const listHtml = syntheticListHtml({
      cards: [{ packageId: 5, modelId: 5, name: 'NO HEIGHT', bookId: 50 }],
    });
    const fetcher: MediaslideFetcher = {
      fetchPackageListHtml: jest.fn(async () => listHtml),
      fetchPackageBookFragment: jest.fn(async () => {
        throw new Error('package_http_error:500');
      }),
    };
    const provider = createMediaslidePackageProvider({ fetcher });
    // Single model + 0 bookOk → bookOkRatio < 0.6 → hard_block. This is the
    // correct behaviour: a 100 % broken book run blocks BEFORE any import.
    await expect(provider.analyze({ url: VALID_URL })).rejects.toThrow('parser_drift_detected');
  });

  it('default-album fetch fails completely + allowDriftBypass → forceSkipReason set when no height-hint', async () => {
    const listHtml = syntheticListHtml({
      cards: [{ packageId: 5, modelId: 5, name: 'NO HEIGHT', bookId: 50 }],
    });
    const fetcher: MediaslideFetcher = {
      fetchPackageListHtml: jest.fn(async () => listHtml),
      fetchPackageBookFragment: jest.fn(async () => {
        throw new Error('package_http_error:500');
      }),
    };
    const provider = createMediaslidePackageProvider({ fetcher });
    const [p] = await provider.analyze({ url: VALID_URL, allowDriftBypass: true });
    expect(p.forceSkipReason).toBe('book_fetch_failed');
    expect(p.portfolio_image_urls).toEqual([]);
  });

  it('default-album fetch fails BUT list provided height-hint + bypass → forceSkipReason absent, no_images skip catches it', async () => {
    const listHtml = syntheticListHtml({
      cards: [{ packageId: 5, modelId: 5, name: 'WITH HINT', bookId: 50, height: 174 }],
    });
    const fetcher: MediaslideFetcher = {
      fetchPackageListHtml: jest.fn(async () => listHtml),
      fetchPackageBookFragment: jest.fn(async () => {
        throw new Error('package_http_error:500');
      }),
    };
    const provider = createMediaslidePackageProvider({ fetcher });
    // bookOkRatio considers a payload "ok" if hasImages OR hasHeight (and no
    // forceSkipReason). With height-hint, this single payload is "ok" → no
    // hard_block. Provider doesn't set forceSkipReason because we have a height
    // hint, BUT there are zero images → buildPreview will mark as `no_images`.
    const [p] = await provider.analyze({ url: VALID_URL });
    expect(p.forceSkipReason).toBeUndefined();
    expect(p.measurements.height).toBe(174);
    expect(p.portfolio_image_urls).toEqual([]);
    expect(p.polaroid_image_urls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4) Drift hard_block / override semantics at the provider boundary
// ---------------------------------------------------------------------------

describe('mediaslidePackageProvider — drift boundary behaviour', () => {
  it('completely unrecognisable list HTML throws ParserDriftError (hard_block)', async () => {
    const fetcher: MediaslideFetcher = {
      fetchPackageListHtml: jest.fn(async () => '<html><body>nothing</body></html>'),
      fetchPackageBookFragment: jest.fn(async () => '<div></div>'),
    };
    const provider = createMediaslidePackageProvider({ fetcher });
    let caught: unknown;
    try {
      await provider.analyze({ url: VALID_URL });
    } catch (e) {
      caught = e;
    }
    expect(isParserDriftError(caught)).toBe(true);
    if (isParserDriftError(caught)) {
      expect(caught.drift.severity).toBe('hard_block');
      expect(caught.drift.reasonCodes).toEqual(
        expect.arrayContaining(['parser_anchor_coverage_low']),
      );
      expect(caught.drift.maskedUrl).toMatch(/^https:\/\/hausofhay\.mediaslide\.com\/package/);
    }
  });

  it('override (allowDriftBypass=true) lets analyze return — but unsafe payloads remain skipped downstream', async () => {
    // 4 of 5 books fail catastrophically — bookOkRatio = 0.2 < 0.6 → hard_block.
    const listHtml = syntheticListHtml({
      cards: Array.from({ length: 5 }, (_, i) => ({
        packageId: 100 + i,
        modelId: 100 + i,
        name: `M${i}`,
        bookId: 1000 + i,
      })),
    });
    const fetcher: MediaslideFetcher = {
      fetchPackageListHtml: jest.fn(async () => listHtml),
      fetchPackageBookFragment: jest.fn(async ({ modelPictureCategoryId }) => {
        // Only the first model's book (1000) succeeds; rest 500.
        if (modelPictureCategoryId === '1000')
          return syntheticBookHtml({
            modelName: 'M0',
            height: 180,
            albums: [{ categoryId: '1000', title: 'PORTFOLIO', count: 1 }],
            imagesForThisCategory: [gcsUrl(100, 1000, 'm0')],
          });
        throw new Error('package_http_error:500');
      }),
    };
    const provider = createMediaslidePackageProvider({ fetcher });

    // Without bypass: hard_block.
    await expect(provider.analyze({ url: VALID_URL })).rejects.toThrow('parser_drift_detected');

    // With bypass: succeeds, returns 5 payloads. 4 of them have forceSkipReason set.
    const onDrift = jest.fn();
    const payloads = await provider.analyze({
      url: VALID_URL,
      allowDriftBypass: true,
      onDrift,
    });
    expect(payloads).toHaveLength(5);
    const skipped = payloads.filter((p) => p.forceSkipReason === 'book_fetch_failed');
    expect(skipped).toHaveLength(4);
    // onDrift fired with hard_block (the override path keeps the banner visible).
    expect(onDrift).toHaveBeenCalled();
    const lastDrift = onDrift.mock.calls[onDrift.mock.calls.length - 1][0];
    expect(lastDrift.severity).toBe('hard_block');
  });
});
