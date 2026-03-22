import { getOrCreateConversation } from '../messengerSupabase';

const maybeSingle = jest.fn();
const insertSingle = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => maybeSingle(),
          }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: () => insertSingle(),
        }),
      }),
    }),
  },
}));

describe('getOrCreateConversation duplicate insert', () => {
  const existing = {
    id: 'conv-1',
    type: 'direct',
    context_id: 'b2b:ctx',
    participant_ids: ['a'],
    title: null,
    created_at: '',
    updated_at: '',
  };

  beforeEach(() => {
    maybeSingle.mockReset();
    insertSingle.mockReset();
  });

  it('returns existing row after unique violation on insert', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: existing, error: null });
    insertSingle.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });

    const r = await getOrCreateConversation('direct', ['a'], 'b2b:ctx', 't');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.conversation.id).toBe('conv-1');
    expect(maybeSingle).toHaveBeenCalledTimes(2);
  });
});
