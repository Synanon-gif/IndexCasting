import { upsertPhotosForModel, type ModelPhotoType } from '../modelPhotosSupabase';

const fromMock = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

describe('upsertPhotosForModel', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('writes is_visible_to_clients based on UI visible flag', async () => {
    const receivedPayload: any[] = [];

    const upsertChain = {
      select: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
    };

    const upsertBuilder = {
      upsert: jest.fn().mockImplementation((payload: any[], _opts: any) => {
        receivedPayload.push(...payload);
        return upsertChain;
      }),
    };

    fromMock.mockReturnValueOnce(upsertBuilder);

    await upsertPhotosForModel('model-1', [
      {
        url: 'a.jpg',
        sort_order: 0,
        visible: false,
        source: null,
        api_external_id: null,
        photo_type: 'portfolio' as ModelPhotoType,
      },
    ]);

    expect(receivedPayload[0].is_visible_to_clients).toBe(false);
    expect(receivedPayload[0].visible).toBe(false);
  });
});
