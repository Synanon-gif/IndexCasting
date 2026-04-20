import { readFileSync } from 'fs';
import { join } from 'path';
import { createMediaslidePackageProvider } from '../mediaslidePackageProvider';
import type { MediaslideFetcher } from '../mediaslidePackageFetcher';

const FIXTURE_DIR = join(__dirname, 'fixtures');
const LIST_HTML = readFileSync(
  join(FIXTURE_DIR, 'mediaslide_package_hausofhay_list.html'),
  'utf-8',
);
const BOOK_HTML = readFileSync(
  join(FIXTURE_DIR, 'mediaslide_package_hausofhay_book674.html'),
  'utf-8',
);

const VALID_URL = 'https://hausofhay.mediaslide.com/package/view/176/1a5f30ca/331/2a9fa1ab';

function buildMockFetcher(overrides: Partial<MediaslideFetcher> = {}): MediaslideFetcher {
  return {
    fetchPackageListHtml: jest.fn(async () => LIST_HTML),
    fetchPackageBookFragment: jest.fn(async ({ modelPictureCategoryId }) => {
      // Beide Alben (674 / 675) nutzen für den Test dasselbe Fixture — das ist OK,
      // wir prüfen primär die Klassifikation und die Counts.
      if (modelPictureCategoryId === '674' || modelPictureCategoryId === '675') {
        return BOOK_HTML;
      }
      return '<div></div>';
    }),
    ...overrides,
  };
}

describe('mediaslidePackageProvider', () => {
  it('detect accepts only valid mediaslide package URLs', () => {
    const provider = createMediaslidePackageProvider({ fetcher: buildMockFetcher() });
    expect(provider.detect({ url: VALID_URL })).toBe(true);
    expect(provider.detect({ url: 'https://example.com/foo' })).toBe(false);
    expect(provider.detect({ url: 'http://hausofhay.mediaslide.com/package/view/1/aa/2/bb' })).toBe(
      false,
    );
    expect(provider.detect({ url: 'not-a-url' })).toBe(false);
  });

  it('analyze returns one ProviderImportPayload for the real fixture', async () => {
    const fetcher = buildMockFetcher();
    const provider = createMediaslidePackageProvider({ fetcher });

    const progress: string[] = [];
    const payloads = await provider.analyze({
      url: VALID_URL,
      onProgress: (p) => progress.push(p.phase),
    });

    expect(payloads).toHaveLength(1);
    const p = payloads[0];
    expect(p.externalProvider).toBe('mediaslide');
    expect(p.externalId).toBe('256');
    expect(p.name).toBe('RÉMI LOVISOLO');
    expect(p.measurements.height).toBe(187);
    expect(p.measurements.chest).toBe(96);
    expect(p.measurements.waist).toBe(82);
    expect(p.measurements.hips).toBe(97);
    expect(p.measurements.legs_inseam).toBe(81);
    expect(p.measurements.shoe_size).toBe(45);
    expect(p.hair_color_raw).toBe('Dark brown');
    expect(p.eye_color_raw).toBe('Green brown');
    expect(p.instagram).toBe('rem_lvs');
    // Beide Alben aus dem Fixture liefern PORTFOLIO/POLAROIDS-Bilder; weil unser Mock
    // beide auf dasselbe Fixture mappt, landen die 5 Bilder in BEIDEN Kategorien
    // (Portfolio weil Album 674 = PORTFOLIO, Polaroids weil Album 675 = POLAROIDS).
    expect(p.portfolio_image_urls.length).toBeGreaterThanOrEqual(5);
    expect(p.polaroid_image_urls.length).toBeGreaterThanOrEqual(5);

    expect(progress[0]).toBe('fetch_list');
    expect(progress).toContain('parse');
    expect(progress).toContain('fetch_books');
  });

  it('analyze sets warning when a book fetch fails (partial success)', async () => {
    const fetcher = buildMockFetcher({
      fetchPackageBookFragment: jest.fn(async ({ modelPictureCategoryId }) => {
        if (modelPictureCategoryId === '674') return BOOK_HTML;
        throw new Error('package_http_error:500');
      }),
    });
    const provider = createMediaslidePackageProvider({ fetcher });
    const payloads = await provider.analyze({ url: VALID_URL });
    expect(payloads).toHaveLength(1);
    const p = payloads[0];
    // Erstes Album lieferte noch Portfolio-Bilder; zweites scheiterte mit Warning
    expect(p.warnings ?? []).toEqual(
      expect.arrayContaining([expect.stringMatching(/album_fetch_failed:POLAROIDS/)]),
    );
    expect(p.portfolio_image_urls.length).toBeGreaterThanOrEqual(5);
    expect(p.polaroid_image_urls).toEqual([]);
  });

  it('analyze throws "package_no_models" when list HTML has none', async () => {
    const fetcher: MediaslideFetcher = {
      fetchPackageListHtml: jest.fn(async () => '<html><body>no cards</body></html>'),
      fetchPackageBookFragment: jest.fn(async () => '<div></div>'),
    };
    const provider = createMediaslidePackageProvider({ fetcher });
    await expect(provider.analyze({ url: VALID_URL })).rejects.toThrow('package_no_models');
  });
});
