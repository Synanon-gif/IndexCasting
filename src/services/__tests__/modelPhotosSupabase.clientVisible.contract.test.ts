/**
 * Contract tests for client-visible portfolio selection — mirrors the filter in
 * `getClientVisiblePortfolioUrlsFromModelPhotos` (modelPhotosSupabase.ts).
 * If this diverges, Discovery / mirror rebuild drift is likely.
 */

function urlsVisibleToClientPortfolio(
  rows: Array<{
    url: string;
    sort_order: number;
    is_visible_to_clients?: boolean | null;
    visible?: boolean | null;
  }>,
): string[] {
  return rows
    .filter((p) => Boolean(p.is_visible_to_clients ?? p.visible))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => p.url);
}

describe('client-visible portfolio filter contract', () => {
  it('excludes hidden portfolio rows from client-facing URL list', () => {
    const rows = [
      { url: 'a', sort_order: 0, is_visible_to_clients: true, visible: true },
      { url: 'b', sort_order: 1, is_visible_to_clients: false, visible: false },
      { url: 'c', sort_order: 2, is_visible_to_clients: true, visible: true },
    ];
    expect(urlsVisibleToClientPortfolio(rows)).toEqual(['a', 'c']);
  });

  it('treats legacy visible=true when is_visible_to_clients is null', () => {
    const rows = [{ url: 'x', sort_order: 0, is_visible_to_clients: null, visible: true }];
    expect(urlsVisibleToClientPortfolio(rows)).toEqual(['x']);
  });

  it('polaroids are out of scope for this contract (caller must pass portfolio-only rows)', () => {
    // Discovery uses portfolio mirror + client-visible portfolio from model_photos;
    // polaroids are intentionally excluded from normal Discovery per §27.1.
    const rows = [{ url: 'pol', sort_order: 0, is_visible_to_clients: true, visible: true }];
    expect(urlsVisibleToClientPortfolio(rows)).toEqual(['pol']);
  });
});
