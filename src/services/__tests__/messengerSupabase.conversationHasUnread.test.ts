import { conversationHasUnreadForViewer } from '../messengerSupabase';

const afterRange = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          neq: () => ({
            is: () => ({
              order: () => ({
                range: () => afterRange(),
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
    afterRange.mockReset();
  });

  it('returns false when conversation or viewer id empty', async () => {
    expect(await conversationHasUnreadForViewer('', 'u1')).toBe(false);
    expect(await conversationHasUnreadForViewer('c1', '')).toBe(false);
    expect(afterRange).not.toHaveBeenCalled();
  });

  it('returns true when an unread countable row exists', async () => {
    afterRange.mockResolvedValue({
      data: [{ id: 'm1', message_type: 'text', metadata: null }],
      error: null,
    });
    await expect(conversationHasUnreadForViewer('conv-1', 'user-a')).resolves.toBe(true);
  });

  it('returns false when no unread rows', async () => {
    afterRange.mockResolvedValue({ data: [], error: null });
    await expect(conversationHasUnreadForViewer('conv-1', 'user-a')).resolves.toBe(false);
  });

  it('returns false when only terminal booking cards are unread', async () => {
    afterRange.mockResolvedValue({
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

  it('scans past a full page of terminal rows to find a countable unread', async () => {
    const terminalPage = Array.from({ length: 100 }, (_, i) => ({
      id: `m${i}`,
      message_type: 'booking' as const,
      metadata: { status: 'deleted' as const },
    }));
    afterRange.mockResolvedValueOnce({ data: terminalPage, error: null }).mockResolvedValueOnce({
      data: [{ id: 'm-good', message_type: 'text', metadata: {} }],
      error: null,
    });
    await expect(conversationHasUnreadForViewer('conv-1', 'user-a')).resolves.toBe(true);
    expect(afterRange).toHaveBeenCalledTimes(2);
  });

  it('returns false on query error', async () => {
    afterRange.mockResolvedValue({ data: null, error: { message: 'x' } });
    await expect(conversationHasUnreadForViewer('conv-1', 'user-a')).resolves.toBe(false);
  });
});
