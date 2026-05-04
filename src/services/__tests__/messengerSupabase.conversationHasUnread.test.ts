import { conversationHasUnreadForViewer } from '../messengerSupabase';

const afterLimit = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          neq: () => ({
            is: () => ({
              order: () => ({
                limit: () => afterLimit(),
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
    afterLimit.mockReset();
  });

  it('returns false when conversation or viewer id empty', async () => {
    expect(await conversationHasUnreadForViewer('', 'u1')).toBe(false);
    expect(await conversationHasUnreadForViewer('c1', '')).toBe(false);
    expect(afterLimit).not.toHaveBeenCalled();
  });

  it('returns true when an unread countable row exists', async () => {
    afterLimit.mockResolvedValue({
      data: [{ id: 'm1', message_type: 'text', metadata: null }],
      error: null,
    });
    await expect(conversationHasUnreadForViewer('conv-1', 'user-a')).resolves.toBe(true);
  });

  it('returns false when no unread rows', async () => {
    afterLimit.mockResolvedValue({ data: [], error: null });
    await expect(conversationHasUnreadForViewer('conv-1', 'user-a')).resolves.toBe(false);
  });

  it('returns false when only terminal booking cards are unread', async () => {
    afterLimit.mockResolvedValue({
      data: [
        {
          id: 'm1',
          message_type: 'booking',
          metadata: { status: 'deleted' },
        },
      ],
      error: null,
    });
    await expect(conversationHasUnreadForViewer('conv-1', 'user-a')).resolves.toBe(false);
  });

  it('returns false on query error', async () => {
    afterLimit.mockResolvedValue({ data: null, error: { message: 'x' } });
    await expect(conversationHasUnreadForViewer('conv-1', 'user-a')).resolves.toBe(false);
  });
});
