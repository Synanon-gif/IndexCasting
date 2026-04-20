import {
  analyzeListAnchors,
  evaluateRunDrift,
  maskUrl,
  MEDIASLIDE_LIST_ANCHORS,
  MEDIASLIDE_PARSER_VERSION,
  PROVIDER_DRIFT_THRESHOLDS,
} from '../providerDriftDetector';
import type { ProviderImportPayload } from '../packageImportTypes';

const HEALTHY_LIST_HTML = `
  <div id="packageModel_1" class="packageModel">
    <a href="#book-100"><img data-original="https://x/y/pictures/1/1/profile-1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg" /></a>
    <div class="modelName" translate="no">Model 1</div>
    <a id="select_1" data-model-id="1"></a>
  </div>
`;

function payload(overrides: Partial<ProviderImportPayload> = {}): ProviderImportPayload {
  return {
    externalProvider: 'mediaslide',
    externalId: '1',
    name: 'M',
    coverImageUrl: null,
    measurements: { height: 180 },
    portfolio_image_urls: ['https://x/p1.jpg'],
    polaroid_image_urls: [],
    ...overrides,
  };
}

describe('providerDriftDetector — analyzeListAnchors', () => {
  it('returns coverage 1 when all anchors present', () => {
    const r = analyzeListAnchors(HEALTHY_LIST_HTML, MEDIASLIDE_LIST_ANCHORS);
    expect(r.coverage).toBe(1);
    expect(r.missing).toEqual([]);
  });

  it('returns coverage 0 when html empty', () => {
    const r = analyzeListAnchors('', MEDIASLIDE_LIST_ANCHORS);
    expect(r.coverage).toBe(0);
    expect(r.missing.length).toBe(MEDIASLIDE_LIST_ANCHORS.length);
  });

  it('reports missing anchors precisely', () => {
    const html = HEALTHY_LIST_HTML.replace('class="packageModel"', 'class="renamed"');
    const r = analyzeListAnchors(html, MEDIASLIDE_LIST_ANCHORS);
    expect(r.missing).toContain('class="packageModel"');
    expect(r.coverage).toBeLessThan(1);
  });

  it('coverage=1 when expectedAnchors is empty', () => {
    const r = analyzeListAnchors('whatever', []);
    expect(r.coverage).toBe(1);
    expect(r.missing).toEqual([]);
  });

  it('is case-insensitive', () => {
    const html = HEALTHY_LIST_HTML.toUpperCase();
    const r = analyzeListAnchors(html, MEDIASLIDE_LIST_ANCHORS);
    expect(r.coverage).toBe(1);
  });
});

describe('providerDriftDetector — maskUrl', () => {
  it('keeps host + first path segment, hides query', () => {
    expect(maskUrl('https://hausofhay.mediaslide.com/package/view/abc123?token=secret')).toBe(
      'https://hausofhay.mediaslide.com/package/…',
    );
  });
  it('handles invalid URL safely', () => {
    expect(maskUrl('not-a-url')).toBe('<invalid-url>');
  });
  it('handles host-only URL', () => {
    expect(maskUrl('https://example.com')).toBe('https://example.com');
  });
});

describe('providerDriftDetector — evaluateRunDrift severity rules', () => {
  it('returns ok when everything is healthy', () => {
    const drift = evaluateRunDrift({
      providerId: 'mediaslide',
      parserVersion: MEDIASLIDE_PARSER_VERSION,
      url: 'https://x.mediaslide.com/package/view/abc',
      listHtml: HEALTHY_LIST_HTML,
      expectedAnchors: MEDIASLIDE_LIST_ANCHORS,
      cardsDetected: 1,
      cardsExtracted: 1,
      payloads: [payload()],
    });
    expect(drift.severity).toBe('ok');
    expect(drift.reasonCodes).toEqual([]);
    expect(drift.parserVersion).toBe(MEDIASLIDE_PARSER_VERSION);
    expect(drift.providerId).toBe('mediaslide');
  });

  it('hard_block when anchor coverage too low', () => {
    const drift = evaluateRunDrift({
      providerId: 'mediaslide',
      parserVersion: MEDIASLIDE_PARSER_VERSION,
      url: 'https://x.mediaslide.com/p',
      listHtml: '<html>completely different layout</html>',
      expectedAnchors: MEDIASLIDE_LIST_ANCHORS,
      cardsDetected: 0,
      cardsExtracted: 0,
      payloads: [],
    });
    expect(drift.severity).toBe('hard_block');
    expect(drift.reasonCodes).toContain('parser_anchor_coverage_low');
    expect(drift.anchorCoverage).toBeLessThan(PROVIDER_DRIFT_THRESHOLDS.MIN_ANCHOR_COVERAGE);
  });

  it('hard_block when extraction ratio too low', () => {
    const drift = evaluateRunDrift({
      providerId: 'mediaslide',
      parserVersion: MEDIASLIDE_PARSER_VERSION,
      url: 'https://x.mediaslide.com/p',
      listHtml: HEALTHY_LIST_HTML,
      expectedAnchors: MEDIASLIDE_LIST_ANCHORS,
      cardsDetected: 10,
      cardsExtracted: 1,
      payloads: [payload()],
    });
    expect(drift.severity).toBe('hard_block');
    expect(drift.reasonCodes).toContain('parser_extraction_low');
    expect(drift.extractionRatio).toBeCloseTo(0.1, 5);
  });

  it('hard_block when book quality ratio too low', () => {
    const drift = evaluateRunDrift({
      providerId: 'mediaslide',
      parserVersion: MEDIASLIDE_PARSER_VERSION,
      url: 'https://x.mediaslide.com/p',
      listHtml: HEALTHY_LIST_HTML,
      expectedAnchors: MEDIASLIDE_LIST_ANCHORS,
      cardsDetected: 5,
      cardsExtracted: 5,
      payloads: [
        payload({
          measurements: {},
          portfolio_image_urls: [],
          polaroid_image_urls: [],
          forceSkipReason: 'book_fetch_failed',
        }),
        payload({
          measurements: {},
          portfolio_image_urls: [],
          polaroid_image_urls: [],
          forceSkipReason: 'book_fetch_failed',
        }),
        payload(),
      ],
    });
    expect(drift.severity).toBe('hard_block');
    expect(drift.reasonCodes).toContain('parser_book_quality_low');
  });

  it('soft_warn when anchors only partially missing but ratios still ok', () => {
    const html = HEALTHY_LIST_HTML.replace('href="#book-', 'href="#legacy-');
    const drift = evaluateRunDrift({
      providerId: 'mediaslide',
      parserVersion: MEDIASLIDE_PARSER_VERSION,
      url: 'https://x.mediaslide.com/p',
      listHtml: html,
      expectedAnchors: MEDIASLIDE_LIST_ANCHORS,
      cardsDetected: 1,
      cardsExtracted: 1,
      payloads: [payload()],
    });
    expect(drift.severity).toBe('soft_warn');
    expect(drift.reasonCodes).toContain('parser_anchor_partial');
  });

  it('bookOkRatio=1 when no payloads (early drift evaluation)', () => {
    const drift = evaluateRunDrift({
      providerId: 'mediaslide',
      parserVersion: MEDIASLIDE_PARSER_VERSION,
      url: 'https://x.mediaslide.com/p',
      listHtml: HEALTHY_LIST_HTML,
      expectedAnchors: MEDIASLIDE_LIST_ANCHORS,
      cardsDetected: 1,
      cardsExtracted: 1,
      payloads: [],
    });
    expect(drift.bookOkRatio).toBe(1);
    expect(drift.severity).toBe('ok');
  });

  it('emits maskedUrl + cardsDetected/cardsExtracted in the result', () => {
    const drift = evaluateRunDrift({
      providerId: 'mediaslide',
      parserVersion: MEDIASLIDE_PARSER_VERSION,
      url: 'https://x.mediaslide.com/package/view/abc?t=secret',
      listHtml: HEALTHY_LIST_HTML,
      expectedAnchors: MEDIASLIDE_LIST_ANCHORS,
      cardsDetected: 7,
      cardsExtracted: 7,
      payloads: [payload()],
    });
    expect(drift.maskedUrl).toBe('https://x.mediaslide.com/package/…');
    expect(drift.cardsDetected).toBe(7);
    expect(drift.cardsExtracted).toBe(7);
  });
});
