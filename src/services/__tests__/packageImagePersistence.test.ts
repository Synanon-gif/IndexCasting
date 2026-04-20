/**
 * Hardened smoke tests for the Phase-2 image mirror flow
 * (`persistImagesForPackageImport`).
 *
 * These tests intentionally try to BREAK the persistence pipeline:
 *  - Cross-model leak: ensures `modelId` is the only sink for uploads.
 *  - Album mixing: portfolio bytes never become polaroid rows and vice versa.
 *  - Order preservation: sequential `addPhoto` calls per album, in input order.
 *  - Partial failures: some downloads fail (404 / wrong MIME / timeout / oversize),
 *    the remainder still persists; classifyImagePersistResult reports `partial`.
 *  - All-failures: classifyImagePersistResult reports `all_failed` and result has
 *    failures.length === attempted.
 *  - No-images: no fetch is called; classify reports `no_images`.
 *  - Mirror rebuild: invoked exactly once per album with the correct modelId.
 *  - Mirror rebuild failure: surfaces `mirrorRebuilt:false` without throwing.
 *  - Cancel between images: AbortSignal stops further downloads cleanly.
 *  - addPhoto failure after a successful upload: marked as `addphoto_failed`.
 *  - Empty/blank URL: marked as `invalid_url` without contacting fetch.
 *  - Content-length pre-cap: oversized images rejected before download.
 *  - HTTP errors / network errors / abort vs. timeout: correct reason codes.
 *
 * They use injection of `fetchImpl`, `uploadImpl`, `addPhotoImpl`, and the
 * mirror-rebuild functions to keep the test fully hermetic (no Supabase, no
 * network, no logger noise beyond `console.warn` from the lazy supabase import,
 * which is suppressed by the global jest setup).
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      update: jest.fn(() => ({ eq: jest.fn(async () => ({ error: null })) })),
    })),
  },
}));

import {
  PACKAGE_IMAGE_DOWNLOAD_LIMIT_BYTES,
  classifyImagePersistResult,
  persistImagesForPackageImport,
  type PackageImagePersistResult,
} from '../packageImagePersistence';

// ---------------------------------------------------------------------------
// Helpers — fake fetch, upload, addPhoto, rebuild
// ---------------------------------------------------------------------------

type FetchCall = { url: string };

function makeFetch(opts: {
  /** Map URL → response. Missing URL → 404. */
  responses: Record<
    string,
    { status?: number; contentType?: string; bytes?: number; body?: Uint8Array }
  >;
  /** URLs that should throw a network error. */
  network?: string[];
  /** URLs that should hang until aborted (simulate timeout). */
  hang?: string[];
}): { fetchImpl: jest.Mock; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = jest.fn(async (url: string, init?: { signal?: AbortSignal }) => {
    calls.push({ url });
    if (opts.network?.includes(url)) {
      throw new Error('connection_reset');
    }
    if (opts.hang?.includes(url)) {
      // Wait until the AbortController fires.
      await new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err: Error & { name?: string } = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
      throw new Error('unreachable');
    }
    const r = opts.responses[url];
    if (!r) {
      const headers = new Headers({ 'content-type': 'text/html' });
      return new Response('not found', { status: 404, headers });
    }
    const status = r.status ?? 200;
    const contentType = r.contentType ?? 'image/jpeg';
    const length = r.bytes ?? r.body?.byteLength ?? 8;
    const headers = new Headers({
      'content-type': contentType,
      'content-length': String(length),
    });
    const body = r.body ?? new Uint8Array(length).fill(0xab);
    return new Response(body as BodyInit, { status, headers });
  });
  return { fetchImpl, calls };
}

function makeUpload(
  opts: {
    /** URLs whose upload should fail (returns null). */
    failUrls?: Set<string>;
    /** Override storage URI generation; default is `supabase-storage://<modelId>/<n>`. */
  } = {},
): {
  uploadImpl: jest.Mock;
  uploads: Array<{ modelId: string; size: number }>;
} {
  const uploads: Array<{ modelId: string; size: number }> = [];
  let counter = 0;
  const uploadImpl = jest.fn(async (modelId: string, file: Blob | File, _opts?: unknown) => {
    counter++;
    uploads.push({ modelId, size: file.size });
    if (opts.failUrls && opts.failUrls.has((file as File).name ?? '')) {
      return null;
    }
    return {
      url: `supabase-storage://documentspictures/${modelId}/img-${counter}.jpg`,
      fileSizeBytes: file.size,
    };
  });
  return { uploadImpl, uploads };
}

function makeAddPhoto(
  opts: {
    /** Photo rows to fail at insert (storage URL match). */
    failUrls?: Set<string>;
  } = {},
): {
  addPhotoImpl: jest.Mock;
  inserts: Array<{ modelId: string; url: string; type: string; sortOrder: number }>;
} {
  const inserts: Array<{ modelId: string; url: string; type: string; sortOrder: number }> = [];
  let n = 0;
  const addPhotoImpl = jest.fn(
    async (modelId: string, url: string, type: string, _size?: number) => {
      if (opts.failUrls?.has(url)) return null;
      n++;
      inserts.push({ modelId, url, type, sortOrder: n });
      return {
        id: `photo-${n}`,
        model_id: modelId,
        url,
        sort_order: n,
        visible: true,
        is_visible_to_clients: true,
        source: null,
        api_external_id: null,
        photo_type: type as 'portfolio' | 'polaroid' | 'private',
      };
    },
  );
  return { addPhotoImpl, inserts };
}

function makeRebuilds(): {
  rebuildPortfolioImpl: jest.Mock;
  rebuildPolaroidsImpl: jest.Mock;
  portfolioCalls: string[];
  polaroidCalls: string[];
} {
  const portfolioCalls: string[] = [];
  const polaroidCalls: string[] = [];
  return {
    portfolioCalls,
    polaroidCalls,
    rebuildPortfolioImpl: jest.fn(async (modelId: string) => {
      portfolioCalls.push(modelId);
      return true;
    }),
    rebuildPolaroidsImpl: jest.fn(async (modelId: string) => {
      polaroidCalls.push(modelId);
      return true;
    }),
  };
}

const PORTFOLIO_URL = (n: number) => `https://cdn.example.test/portfolio/${n}.jpg`;
const POLAROID_URL = (n: number) => `https://cdn.example.test/polaroid/${n}.jpg`;

// ---------------------------------------------------------------------------
// 1) Happy path — full persistence, mirror rebuild, ordering
// ---------------------------------------------------------------------------

describe('persistImagesForPackageImport — happy path', () => {
  it('downloads, uploads, and addPhoto for portfolio THEN polaroids in input order', async () => {
    const portfolioUrls = [PORTFOLIO_URL(1), PORTFOLIO_URL(2), PORTFOLIO_URL(3)];
    const polaroidUrls = [POLAROID_URL(1), POLAROID_URL(2)];

    const { fetchImpl, calls } = makeFetch({
      responses: Object.fromEntries(
        [...portfolioUrls, ...polaroidUrls].map((u) => [
          u,
          { contentType: 'image/jpeg', bytes: 1024 },
        ]),
      ),
    });
    const { uploadImpl, uploads } = makeUpload();
    const { addPhotoImpl, inserts } = makeAddPhoto();
    const { rebuildPortfolioImpl, rebuildPolaroidsImpl, portfolioCalls, polaroidCalls } =
      makeRebuilds();

    const result = await persistImagesForPackageImport({
      modelId: 'model-A',
      provider: 'mediaslide',
      providerExternalId: 'MS-1',
      portfolioUrls,
      polaroidUrls,
      options: { fetchImpl, uploadImpl, addPhotoImpl, rebuildPortfolioImpl, rebuildPolaroidsImpl },
    });

    expect(result.portfolioPersisted).toBe(3);
    expect(result.portfolioAttempted).toBe(3);
    expect(result.polaroidPersisted).toBe(2);
    expect(result.polaroidAttempted).toBe(2);
    expect(result.failures).toEqual([]);
    expect(result.mirrorRebuilt).toBe(true);

    expect(calls.map((c) => c.url)).toEqual([...portfolioUrls, ...polaroidUrls]);
    expect(uploads.every((u) => u.modelId === 'model-A')).toBe(true);
    expect(inserts.map((i) => i.type)).toEqual([
      'portfolio',
      'portfolio',
      'portfolio',
      'polaroid',
      'polaroid',
    ]);
    expect(inserts.map((i) => i.sortOrder)).toEqual([1, 2, 3, 4, 5]);
    expect(portfolioCalls).toEqual(['model-A']);
    expect(polaroidCalls).toEqual(['model-A']);
    expect(classifyImagePersistResult(result)).toBe('all_ok');
  });
});

// ---------------------------------------------------------------------------
// 2) Cross-model & cross-album isolation
// ---------------------------------------------------------------------------

describe('persistImagesForPackageImport — isolation invariants', () => {
  it('all uploads land at the modelId passed to the function (no leak from URL/EXT-ID)', async () => {
    const url1 = PORTFOLIO_URL(1);
    const url2 = POLAROID_URL(1);
    const { fetchImpl } = makeFetch({
      responses: { [url1]: { contentType: 'image/jpeg' }, [url2]: { contentType: 'image/png' } },
    });
    const { uploadImpl, uploads } = makeUpload();
    const { addPhotoImpl } = makeAddPhoto();
    const rebuilds = makeRebuilds();

    await persistImagesForPackageImport({
      modelId: 'target-model',
      provider: 'mediaslide',
      providerExternalId: 'evil/../../other-model', // attempt to traverse
      portfolioUrls: [url1],
      polaroidUrls: [url2],
      options: { fetchImpl, uploadImpl, addPhotoImpl, ...rebuilds },
    });

    expect(uploads).toHaveLength(2);
    expect(new Set(uploads.map((u) => u.modelId))).toEqual(new Set(['target-model']));
  });

  it('portfolio bytes are inserted ONLY as photo_type=portfolio (and vice versa)', async () => {
    const portfolio = [PORTFOLIO_URL(10), PORTFOLIO_URL(11)];
    const polaroids = [POLAROID_URL(10)];
    const { fetchImpl } = makeFetch({
      responses: Object.fromEntries(
        [...portfolio, ...polaroids].map((u) => [u, { contentType: 'image/jpeg' }]),
      ),
    });
    const { uploadImpl } = makeUpload();
    const { addPhotoImpl, inserts } = makeAddPhoto();
    const rebuilds = makeRebuilds();

    await persistImagesForPackageImport({
      modelId: 'm',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: portfolio,
      polaroidUrls: polaroids,
      options: { fetchImpl, uploadImpl, addPhotoImpl, ...rebuilds },
    });

    const portfolioRows = inserts.filter((i) => i.type === 'portfolio');
    const polaroidRows = inserts.filter((i) => i.type === 'polaroid');
    expect(portfolioRows).toHaveLength(2);
    expect(polaroidRows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3) Partial / all-failed / no-images classifications
// ---------------------------------------------------------------------------

describe('persistImagesForPackageImport — failure classification', () => {
  it('returns no_images for empty input and never calls fetch', async () => {
    const { fetchImpl, calls } = makeFetch({ responses: {} });
    const { uploadImpl } = makeUpload();
    const { addPhotoImpl } = makeAddPhoto();
    const rebuilds = makeRebuilds();

    const res = await persistImagesForPackageImport({
      modelId: 'm',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: [],
      polaroidUrls: [],
      options: { fetchImpl, uploadImpl, addPhotoImpl, ...rebuilds },
    });

    expect(calls).toHaveLength(0);
    expect(classifyImagePersistResult(res)).toBe('no_images');
  });

  it('partial: 2/3 portfolio succeed (one 404), polaroids ok → status partial', async () => {
    const ok1 = PORTFOLIO_URL(1);
    const ok2 = PORTFOLIO_URL(2);
    const bad = PORTFOLIO_URL(3);
    const pol = POLAROID_URL(1);
    const { fetchImpl } = makeFetch({
      responses: {
        [ok1]: { contentType: 'image/jpeg' },
        [ok2]: { contentType: 'image/jpeg' },
        // bad → 404 (default behavior of makeFetch when missing)
        [pol]: { contentType: 'image/jpeg' },
      },
    });
    const { uploadImpl } = makeUpload();
    const { addPhotoImpl } = makeAddPhoto();
    const rebuilds = makeRebuilds();

    const res = await persistImagesForPackageImport({
      modelId: 'm',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: [ok1, bad, ok2],
      polaroidUrls: [pol],
      options: { fetchImpl, uploadImpl, addPhotoImpl, ...rebuilds },
    });

    expect(res.portfolioPersisted).toBe(2);
    expect(res.portfolioAttempted).toBe(3);
    expect(res.polaroidPersisted).toBe(1);
    expect(res.polaroidAttempted).toBe(1);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]).toMatchObject({
      type: 'portfolio',
      index: 1,
      reason: 'download_http_error',
    });
    expect(classifyImagePersistResult(res)).toBe('partial');
  });

  it('all_failed: every download is 404 → no inserts, no upload, mirror is NOT rebuilt (legacy-mirror protection)', async () => {
    const { fetchImpl } = makeFetch({ responses: {} });
    const { uploadImpl, uploads } = makeUpload();
    const { addPhotoImpl, inserts } = makeAddPhoto();
    const rebuilds = makeRebuilds();

    const res = await persistImagesForPackageImport({
      modelId: 'm',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: [PORTFOLIO_URL(1), PORTFOLIO_URL(2)],
      polaroidUrls: [POLAROID_URL(1)],
      options: { fetchImpl, uploadImpl, addPhotoImpl, ...rebuilds },
    });

    expect(uploads).toHaveLength(0);
    expect(inserts).toHaveLength(0);
    expect(classifyImagePersistResult(res)).toBe('all_failed');
    // Legacy-Mirror-Schutz: bei 0 persistiert KEIN Rebuild — sonst würden
    // bestehende externe URLs eines Legacy-Modells (vor Phase 2 importiert,
    // noch nicht in `model_photos` gespiegelt) still auf `[]` gesetzt.
    expect(rebuilds.rebuildPortfolioImpl).not.toHaveBeenCalled();
    expect(rebuilds.rebuildPolaroidsImpl).not.toHaveBeenCalled();
    expect(res.mirrorRebuilt).toBe(true);
    expect(res.failures.every((f) => f.reason === 'download_http_error')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4) Granular failure reasons
// ---------------------------------------------------------------------------

describe('persistImagesForPackageImport — per-failure reason codes', () => {
  function getReasons(res: PackageImagePersistResult): string[] {
    return res.failures.map((f) => f.reason);
  }

  it('invalid_url for empty / whitespace / non-string URLs', async () => {
    const { fetchImpl, calls } = makeFetch({ responses: {} });
    const { uploadImpl } = makeUpload();
    const { addPhotoImpl } = makeAddPhoto();
    const rebuilds = makeRebuilds();

    const res = await persistImagesForPackageImport({
      modelId: 'm',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: ['', '   ', undefined as unknown as string],
      polaroidUrls: [],
      options: { fetchImpl, uploadImpl, addPhotoImpl, ...rebuilds },
    });

    expect(calls).toHaveLength(0);
    expect(getReasons(res)).toEqual(['invalid_url', 'invalid_url', 'invalid_url']);
  });

  it('invalid_content_type when server returns text/html', async () => {
    const url = PORTFOLIO_URL(1);
    const { fetchImpl } = makeFetch({
      responses: { [url]: { contentType: 'text/html' } },
    });
    const { uploadImpl } = makeUpload();
    const { addPhotoImpl } = makeAddPhoto();
    const rebuilds = makeRebuilds();

    const res = await persistImagesForPackageImport({
      modelId: 'm',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: [url],
      polaroidUrls: [],
      options: { fetchImpl, uploadImpl, addPhotoImpl, ...rebuilds },
    });

    expect(getReasons(res)).toEqual(['invalid_content_type']);
  });

  it('too_large via content-length pre-cap (no body downloaded)', async () => {
    const url = PORTFOLIO_URL(1);
    const oversized = PACKAGE_IMAGE_DOWNLOAD_LIMIT_BYTES + 1;
    const { fetchImpl } = makeFetch({
      responses: {
        [url]: { contentType: 'image/jpeg', bytes: oversized, body: new Uint8Array(8) },
      },
    });
    const { uploadImpl, uploads } = makeUpload();
    const { addPhotoImpl } = makeAddPhoto();
    const rebuilds = makeRebuilds();

    const res = await persistImagesForPackageImport({
      modelId: 'm',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: [url],
      polaroidUrls: [],
      options: { fetchImpl, uploadImpl, addPhotoImpl, ...rebuilds },
    });

    expect(getReasons(res)).toEqual(['too_large']);
    expect(uploads).toHaveLength(0);
  });

  it('too_large via actual body when content-length is missing', async () => {
    const url = PORTFOLIO_URL(1);
    const big = new Uint8Array(PACKAGE_IMAGE_DOWNLOAD_LIMIT_BYTES + 10);
    const fetchImpl = jest.fn(async () => {
      const headers = new Headers({ 'content-type': 'image/jpeg' });
      // no content-length header
      return new Response(big as BodyInit, { status: 200, headers });
    });
    const { uploadImpl } = makeUpload();
    const { addPhotoImpl } = makeAddPhoto();
    const rebuilds = makeRebuilds();

    const res = await persistImagesForPackageImport({
      modelId: 'm',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: [url],
      polaroidUrls: [],
      options: { fetchImpl, uploadImpl, addPhotoImpl, ...rebuilds },
    });

    expect(getReasons(res)).toEqual(['too_large']);
  });

  it('empty_response when body is zero bytes', async () => {
    const url = PORTFOLIO_URL(1);
    const fetchImpl = jest.fn(async () => {
      const headers = new Headers({ 'content-type': 'image/jpeg', 'content-length': '0' });
      return new Response(new Uint8Array(0) as BodyInit, { status: 200, headers });
    });
    const { uploadImpl } = makeUpload();
    const { addPhotoImpl } = makeAddPhoto();
    const rebuilds = makeRebuilds();

    const res = await persistImagesForPackageImport({
      modelId: 'm',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: [url],
      polaroidUrls: [],
      options: { fetchImpl, uploadImpl, addPhotoImpl, ...rebuilds },
    });

    expect(getReasons(res)).toEqual(['empty_response']);
  });

  it('download_network when fetch throws non-abort', async () => {
    const url = PORTFOLIO_URL(1);
    const { fetchImpl } = makeFetch({ responses: {}, network: [url] });
    const { uploadImpl } = makeUpload();
    const { addPhotoImpl } = makeAddPhoto();
    const rebuilds = makeRebuilds();

    const res = await persistImagesForPackageImport({
      modelId: 'm',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: [url],
      polaroidUrls: [],
      options: { fetchImpl, uploadImpl, addPhotoImpl, ...rebuilds },
    });

    expect(getReasons(res)).toEqual(['download_network']);
  });

  it('download_timeout when timeout elapses before response', async () => {
    const url = PORTFOLIO_URL(1);
    const { fetchImpl } = makeFetch({ responses: {}, hang: [url] });
    const { uploadImpl } = makeUpload();
    const { addPhotoImpl } = makeAddPhoto();
    const rebuilds = makeRebuilds();

    const res = await persistImagesForPackageImport({
      modelId: 'm',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: [url],
      polaroidUrls: [],
      options: { fetchImpl, uploadImpl, addPhotoImpl, ...rebuilds, timeoutMs: 10 },
    });

    expect(getReasons(res)).toEqual(['download_timeout']);
  });

  it('upload_failed when the upload pipeline returns null', async () => {
    const url = PORTFOLIO_URL(1);
    const { fetchImpl } = makeFetch({ responses: { [url]: { contentType: 'image/jpeg' } } });
    const { uploadImpl } = makeUpload({ failUrls: new Set(['pkg-X-0.jpg']) });
    const { addPhotoImpl, inserts } = makeAddPhoto();
    const rebuilds = makeRebuilds();

    const res = await persistImagesForPackageImport({
      modelId: 'm',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: [url],
      polaroidUrls: [],
      options: { fetchImpl, uploadImpl, addPhotoImpl, ...rebuilds },
    });

    expect(getReasons(res)).toEqual(['upload_failed']);
    expect(inserts).toHaveLength(0);
  });

  it('addphoto_failed when DB insert returns null after a successful upload', async () => {
    const url = PORTFOLIO_URL(1);
    const { fetchImpl } = makeFetch({ responses: { [url]: { contentType: 'image/jpeg' } } });
    const { uploadImpl, uploads } = makeUpload();
    const { addPhotoImpl } = makeAddPhoto({
      failUrls: new Set(['supabase-storage://documentspictures/m/img-1.jpg']),
    });
    const rebuilds = makeRebuilds();

    const res = await persistImagesForPackageImport({
      modelId: 'm',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: [url],
      polaroidUrls: [],
      options: { fetchImpl, uploadImpl, addPhotoImpl, ...rebuilds },
    });

    expect(uploads).toHaveLength(1);
    expect(getReasons(res)).toEqual(['addphoto_failed']);
  });
});

// ---------------------------------------------------------------------------
// 5) Cancel / abort semantics
// ---------------------------------------------------------------------------

describe('persistImagesForPackageImport — cancel between images', () => {
  it('aborting before the second image stops further downloads, marks them aborted', async () => {
    const u1 = PORTFOLIO_URL(1);
    const u2 = PORTFOLIO_URL(2);
    const u3 = PORTFOLIO_URL(3);
    const ctrl = new AbortController();
    const { fetchImpl, calls } = makeFetch({
      responses: {
        [u1]: { contentType: 'image/jpeg' },
        [u2]: { contentType: 'image/jpeg' },
        [u3]: { contentType: 'image/jpeg' },
      },
    });
    const { uploadImpl } = makeUpload();
    const { addPhotoImpl } = makeAddPhoto();
    const rebuilds = makeRebuilds();

    const res = await persistImagesForPackageImport({
      modelId: 'm',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: [u1, u2, u3],
      polaroidUrls: [],
      options: {
        fetchImpl,
        uploadImpl,
        addPhotoImpl,
        ...rebuilds,
        signal: ctrl.signal,
        onImageProgress: (ev) => {
          if (ev.outcome === 'persisted' && ev.index === 0) ctrl.abort();
        },
      },
    });

    expect(res.portfolioPersisted).toBe(1);
    expect(res.failures.map((f) => f.reason)).toEqual(['download_aborted', 'download_aborted']);
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 6) Mirror-rebuild plumbing
// ---------------------------------------------------------------------------

describe('persistImagesForPackageImport — mirror rebuild', () => {
  it('calls rebuild for both albums exactly once with modelId when both have persisted images', async () => {
    const portUrl = PORTFOLIO_URL(1);
    const polUrl = POLAROID_URL(1);
    const { fetchImpl } = makeFetch({
      responses: {
        [portUrl]: { contentType: 'image/jpeg' },
        [polUrl]: { contentType: 'image/jpeg' },
      },
    });
    const { uploadImpl } = makeUpload();
    const { addPhotoImpl } = makeAddPhoto();
    const rebuilds = makeRebuilds();

    const res = await persistImagesForPackageImport({
      modelId: 'rebuild-target',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: [portUrl],
      polaroidUrls: [polUrl],
      options: { fetchImpl, uploadImpl, addPhotoImpl, ...rebuilds },
    });

    expect(rebuilds.rebuildPortfolioImpl).toHaveBeenCalledTimes(1);
    expect(rebuilds.rebuildPolaroidsImpl).toHaveBeenCalledTimes(1);
    expect(rebuilds.portfolioCalls).toEqual(['rebuild-target']);
    expect(rebuilds.polaroidCalls).toEqual(['rebuild-target']);
    expect(res.mirrorRebuilt).toBe(true);
  });

  it('rebuild failure surfaces as mirrorRebuilt:false (and does not throw)', async () => {
    const url = PORTFOLIO_URL(1);
    const { fetchImpl } = makeFetch({ responses: { [url]: { contentType: 'image/jpeg' } } });
    const { uploadImpl } = makeUpload();
    const { addPhotoImpl } = makeAddPhoto();
    const rebuildPortfolioImpl = jest.fn(async () => false);
    const rebuildPolaroidsImpl = jest.fn(async () => true);

    const res = await persistImagesForPackageImport({
      modelId: 'm',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: [url],
      polaroidUrls: [],
      options: {
        fetchImpl,
        uploadImpl,
        addPhotoImpl,
        rebuildPortfolioImpl,
        rebuildPolaroidsImpl,
      },
    });

    expect(res.portfolioPersisted).toBe(1);
    expect(res.mirrorRebuilt).toBe(false);
  });

  it('rebuild throwing surfaces as mirrorRebuilt:false (caught internally)', async () => {
    const url = PORTFOLIO_URL(1);
    const { fetchImpl } = makeFetch({ responses: { [url]: { contentType: 'image/jpeg' } } });
    const { uploadImpl } = makeUpload();
    const { addPhotoImpl } = makeAddPhoto();
    const rebuildPortfolioImpl = jest.fn(async () => {
      throw new Error('rls_denied');
    });
    const rebuildPolaroidsImpl = jest.fn(async () => true);

    const res = await persistImagesForPackageImport({
      modelId: 'm',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: [url],
      polaroidUrls: [],
      options: {
        fetchImpl,
        uploadImpl,
        addPhotoImpl,
        rebuildPortfolioImpl,
        rebuildPolaroidsImpl,
      },
    });

    expect(res.mirrorRebuilt).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6b) Legacy-Mirror protection: skip rebuild per album when 0 images persisted.
// Background: a legacy model (imported before Phase 2) may still have external
// URLs in `models.portfolio_images` / `models.polaroids`. Re-importing such a
// model with persistImages=true MUST NOT silently wipe these columns when the
// new persistence run produces zero rows. The rebuild reads exclusively from
// `model_photos`, so calling it after 0 successful inserts would set the
// mirror to `[]` — destructive data loss without honest visibility.
// ---------------------------------------------------------------------------

describe('persistImagesForPackageImport — legacy-mirror protection', () => {
  it('no_images: empty input → both rebuilds are skipped, mirrorRebuilt stays true', async () => {
    const { fetchImpl } = makeFetch({ responses: {} });
    const { uploadImpl } = makeUpload();
    const { addPhotoImpl } = makeAddPhoto();
    const rebuilds = makeRebuilds();

    const res = await persistImagesForPackageImport({
      modelId: 'm',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: [],
      polaroidUrls: [],
      options: { fetchImpl, uploadImpl, addPhotoImpl, ...rebuilds },
    });

    expect(rebuilds.rebuildPortfolioImpl).not.toHaveBeenCalled();
    expect(rebuilds.rebuildPolaroidsImpl).not.toHaveBeenCalled();
    expect(res.mirrorRebuilt).toBe(true);
    expect(classifyImagePersistResult(res)).toBe('no_images');
  });

  it('only portfolio persisted: portfolio rebuild runs, polaroid rebuild is skipped', async () => {
    const url = PORTFOLIO_URL(1);
    const polUrl = POLAROID_URL(1); // will 404
    const { fetchImpl } = makeFetch({
      responses: { [url]: { contentType: 'image/jpeg' } },
    });
    const { uploadImpl } = makeUpload();
    const { addPhotoImpl } = makeAddPhoto();
    const rebuilds = makeRebuilds();

    const res = await persistImagesForPackageImport({
      modelId: 'mixed',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: [url],
      polaroidUrls: [polUrl],
      options: { fetchImpl, uploadImpl, addPhotoImpl, ...rebuilds },
    });

    expect(res.portfolioPersisted).toBe(1);
    expect(res.polaroidPersisted).toBe(0);
    expect(rebuilds.rebuildPortfolioImpl).toHaveBeenCalledWith('mixed');
    expect(rebuilds.rebuildPolaroidsImpl).not.toHaveBeenCalled();
    // mirrorRebuilt covers the rebuilds we DID run (portfolio ok).
    expect(res.mirrorRebuilt).toBe(true);
    expect(classifyImagePersistResult(res)).toBe('partial');
  });

  it('only polaroids persisted: polaroid rebuild runs, portfolio rebuild is skipped', async () => {
    const portUrl = PORTFOLIO_URL(1); // will 404
    const polUrl = POLAROID_URL(1);
    const { fetchImpl } = makeFetch({
      responses: { [polUrl]: { contentType: 'image/jpeg' } },
    });
    const { uploadImpl } = makeUpload();
    const { addPhotoImpl } = makeAddPhoto();
    const rebuilds = makeRebuilds();

    const res = await persistImagesForPackageImport({
      modelId: 'mixed-2',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: [portUrl],
      polaroidUrls: [polUrl],
      options: { fetchImpl, uploadImpl, addPhotoImpl, ...rebuilds },
    });

    expect(res.portfolioPersisted).toBe(0);
    expect(res.polaroidPersisted).toBe(1);
    expect(rebuilds.rebuildPolaroidsImpl).toHaveBeenCalledWith('mixed-2');
    expect(rebuilds.rebuildPortfolioImpl).not.toHaveBeenCalled();
    expect(res.mirrorRebuilt).toBe(true);
    expect(classifyImagePersistResult(res)).toBe('partial');
  });

  it('all aborted before any persist: no rebuild call (legacy mirror untouched)', async () => {
    const u1 = PORTFOLIO_URL(1);
    const u2 = POLAROID_URL(1);
    const ctrl = new AbortController();
    ctrl.abort();
    const { fetchImpl, calls } = makeFetch({
      responses: {
        [u1]: { contentType: 'image/jpeg' },
        [u2]: { contentType: 'image/jpeg' },
      },
    });
    const { uploadImpl } = makeUpload();
    const { addPhotoImpl } = makeAddPhoto();
    const rebuilds = makeRebuilds();

    const res = await persistImagesForPackageImport({
      modelId: 'cancelled-model',
      provider: 'mediaslide',
      providerExternalId: 'X',
      portfolioUrls: [u1],
      polaroidUrls: [u2],
      options: { fetchImpl, uploadImpl, addPhotoImpl, ...rebuilds, signal: ctrl.signal },
    });

    expect(calls).toHaveLength(0);
    expect(res.failures.map((f) => f.reason)).toEqual(['download_aborted', 'download_aborted']);
    expect(rebuilds.rebuildPortfolioImpl).not.toHaveBeenCalled();
    expect(rebuilds.rebuildPolaroidsImpl).not.toHaveBeenCalled();
    expect(res.mirrorRebuilt).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7) Provider neutrality
// ---------------------------------------------------------------------------

describe('persistImagesForPackageImport — provider neutrality', () => {
  it('netwalk works identically (uploads run, no provider-specific URL pattern enforced)', async () => {
    const url = 'https://nw.example.test/img/abcd.jpg';
    const { fetchImpl } = makeFetch({ responses: { [url]: { contentType: 'image/jpeg' } } });
    const { uploadImpl, uploads } = makeUpload();
    const { addPhotoImpl, inserts } = makeAddPhoto();
    const rebuilds = makeRebuilds();

    const res = await persistImagesForPackageImport({
      modelId: 'nw-model',
      provider: 'netwalk',
      providerExternalId: 'NW-1',
      portfolioUrls: [url],
      polaroidUrls: [],
      options: { fetchImpl, uploadImpl, addPhotoImpl, ...rebuilds },
    });

    expect(res.portfolioPersisted).toBe(1);
    expect(uploads).toHaveLength(1);
    expect(inserts).toHaveLength(1);
  });
});
