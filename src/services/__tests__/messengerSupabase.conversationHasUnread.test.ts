import { conversationHasUnreadForViewer } from '../messengerSupabase';

const maybeSingle = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          neq: () => ({
            is: () => ({
              limit: () => ({
                maybeSingle: () => maybeSingle(),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}));

describe('conversationHasUnreadForViewer', () => {
  beforeEach(() => {
    maybeSingle.mockReset();
  });

  it('returns false when conversation or viewer id empty', async () => {
    expect(await conversationHasUnreadForViewer('', 'u1')).toBe(false);
    expect(await conversationHasUnreadForViewer('c1', '')).toBe(false);
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('returns true when an unread incoming row exists', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 'm1' }, error: null });
    await expect(conversationHasUnreadForViewer('conv-1', 'user-a')).resolves.toBe(true);
  });

  it('returns false when no unread rows', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(conversationHasUnreadForViewer('conv-1', 'user-a')).resolves.toBe(false);
  });

  it('returns false on query error', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'x' } });
    await expect(conversationHasUnreadForViewer('conv-1', 'user-a')).resolves.toBe(false);
  });
});
