import {
  rebuildPortfolioImagesFromModelPhotos,
  rebuildPolaroidsFromModelPhotos,
} from '../modelPhotosSupabase';

const fromMock = jest.fn();
const rpcMock = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

describe('rebuildPortfolioImagesFromModelPhotos', () => {
  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
  });

  it('syncs visible portfolio URLs in sort_order to agency_update_model_full', async () => {
    // Fluent query builder: select/eq must return the same object so .order() runs last.
    const builder: {
      select: jest.Mock;
      eq: jest.Mock;
      order: jest.Mock;
      limit: jest.Mock;
    } = {} as { select: jest.Mock; eq: jest.Mock; order: jest.Mock; limit: jest.Mock };
    builder.select = jest.fn(() => builder);
    builder.eq = jest.fn(() => builder);
    builder.order = jest.fn(() => builder);
    builder.limit = jest.fn().mockResolvedValue({
      data: [
        {
          id: '1',
          model_id: 'm1',
          url: 'supabase-storage://documentspictures/model-photos/m1/a.jpg',
          sort_order: 1,
          visible: true,
          is_visible_to_clients: true,
          source: null,
          api_external_id: null,
          photo_type: 'portfolio',
        },
        {
          id: '2',
          model_id: 'm1',
          url: 'supabase-storage://documentspictures/model-photos/m1/b.jpg',
          sort_order: 0,
          visible: true,
          is_visible_to_clients: true,
          source: null,
          api_external_id: null,
          photo_type: 'portfolio',
        },
      ],
      error: null,
    });
    fromMock.mockReturnValue(builder);
    rpcMock.mockResolvedValue({ error: null });

    const ok = await rebuildPortfolioImagesFromModelPhotos('m1');
    expect(ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith('agency_update_model_full', {
      p_model_id: 'm1',
      p_portfolio_images: [
        'supabase-storage://documentspictures/model-photos/m1/b.jpg',
        'supabase-storage://documentspictures/model-photos/m1/a.jpg',
      ],
    });
  });

  it('filters out client-hidden portfolio rows', async () => {
    const b: { select: jest.Mock; eq: jest.Mock; order: jest.Mock; limit: jest.Mock } = {} as never;
    b.select = jest.fn(() => b);
    b.eq = jest.fn(() => b);
    b.order = jest.fn(() => b);
    b.limit = jest.fn().mockResolvedValue({
      data: [
        {
          id: '1',
          model_id: 'm1',
          url: 'hidden.jpg',
          sort_order: 0,
          visible: false,
          is_visible_to_clients: false,
          source: null,
          api_external_id: null,
          photo_type: 'portfolio',
        },
        {
          id: '2',
          model_id: 'm1',
          url: 'shown.jpg',
          sort_order: 1,
          visible: true,
          is_visible_to_clients: true,
          source: null,
          api_external_id: null,
          photo_type: 'portfolio',
        },
      ],
      error: null,
    });
    fromMock.mockReturnValue(b);
    rpcMock.mockResolvedValue({ error: null });

    await rebuildPortfolioImagesFromModelPhotos('m1');
    expect(rpcMock).toHaveBeenCalledWith('agency_update_model_full', {
      p_model_id: 'm1',
      p_portfolio_images: ['shown.jpg'],
    });
  });
});

describe('rebuildPolaroidsFromModelPhotos', () => {
  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
  });

  it('syncs visible polaroid URLs via p_polaroids', async () => {
    const b: { select: jest.Mock; eq: jest.Mock; order: jest.Mock; limit: jest.Mock } = {} as never;
    b.select = jest.fn(() => b);
    b.eq = jest.fn(() => b);
    b.order = jest.fn(() => b);
    b.limit = jest.fn().mockResolvedValue({
      data: [
        {
          id: 'p1',
          model_id: 'm1',
          url: 'pol.jpg',
          sort_order: 0,
          visible: true,
          is_visible_to_clients: true,
          source: null,
          api_external_id: null,
          photo_type: 'polaroid',
        },
      ],
      error: null,
    });
    fromMock.mockReturnValue(b);
    rpcMock.mockResolvedValue({ error: null });

    const ok = await rebuildPolaroidsFromModelPhotos('m1');
    expect(ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith('agency_update_model_full', {
      p_model_id: 'm1',
      p_polaroids: ['pol.jpg'],
    });
  });
});
