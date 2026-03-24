import {
  buildGuestChatContextId,
  createGuestConversation,
  sendGuestBookingRequest,
  getGuestConversation,
} from '../guestChatSupabase';

// ─── Supabase mock ─────────────────────────────────────────────────────────────
const mockMaybeSingle = jest.fn();
const mockInsertSingle = jest.fn();
const mockSendMessage = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => mockMaybeSingle(),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: () => mockInsertSingle(),
        }),
      }),
    }),
  },
}));

jest.mock('../messengerSupabase', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}));

// ─── buildGuestChatContextId ───────────────────────────────────────────────────
describe('buildGuestChatContextId', () => {
  it('produces a stable context_id string', () => {
    const ctx = buildGuestChatContextId('user-1', 'org-1');
    expect(ctx).toBe('guest:user-1:org-1');
  });
});

// ─── createGuestConversation ───────────────────────────────────────────────────
describe('createGuestConversation', () => {
  const guestId = 'guest-user-1';
  const orgId = 'agency-org-1';
  const agencyMemberIds = ['agent-1', 'agent-2'];

  const existingConversation = {
    id: 'conv-1',
    type: 'direct',
    context_id: `guest:${guestId}:${orgId}`,
    participant_ids: [guestId, ...agencyMemberIds],
    guest_user_id: guestId,
    agency_organization_id: orgId,
    title: 'Guest Client',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  };

  beforeEach(() => {
    mockMaybeSingle.mockReset();
    mockInsertSingle.mockReset();
  });

  it('returns existing conversation when found', async () => {
    mockMaybeSingle.mockResolvedValue({ data: existingConversation, error: null });
    const result = await createGuestConversation(guestId, orgId, agencyMemberIds);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.conversation.id).toBe('conv-1');
      expect(result.created).toBe(false);
    }
  });

  it('creates a new conversation when none exists', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockInsertSingle.mockResolvedValue({ data: existingConversation, error: null });
    const result = await createGuestConversation(guestId, orgId, agencyMemberIds);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.created).toBe(true);
      expect(result.conversation.guest_user_id).toBe(guestId);
    }
  });

  it('handles duplicate key insert by returning existing row', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: existingConversation, error: null });
    mockInsertSingle.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });
    const result = await createGuestConversation(guestId, orgId, agencyMemberIds);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.conversation.id).toBe('conv-1');
  });

  it('returns ok:false on unhandled insert error', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockInsertSingle.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });
    const result = await createGuestConversation(guestId, orgId, agencyMemberIds);
    expect(result.ok).toBe(false);
  });
});

// ─── sendGuestBookingRequest ───────────────────────────────────────────────────
describe('sendGuestBookingRequest', () => {
  beforeEach(() => mockSendMessage.mockReset());

  const payload = {
    selected_models: ['model-1', 'model-2'],
    requested_date: '2025-06-15',
    message: 'Looking for editorial models for a summer campaign.',
    guest_link_id: 'link-abc',
  };

  it('calls sendMessage with message_type booking_request and correct metadata', async () => {
    const fakeMsgRow = { id: 'msg-1', conversation_id: 'conv-1', sender_id: 'guest-1' };
    mockSendMessage.mockResolvedValue(fakeMsgRow);

    const result = await sendGuestBookingRequest('conv-1', 'guest-1', payload);
    expect(result).toEqual(fakeMsgRow);
    expect(mockSendMessage).toHaveBeenCalledWith(
      'conv-1',
      'guest-1',
      expect.any(String),
      undefined,
      undefined,
      expect.objectContaining({
        messageType: 'booking_request',
        metadata: expect.objectContaining({
          selected_models: ['model-1', 'model-2'],
          requested_date: '2025-06-15',
          message: payload.message,
          guest_link_id: 'link-abc',
        }),
      }),
    );
  });

  it('returns null when sendMessage fails', async () => {
    mockSendMessage.mockResolvedValue(null);
    const result = await sendGuestBookingRequest('conv-1', 'guest-1', payload);
    expect(result).toBeNull();
  });
});

// ─── getGuestConversation ──────────────────────────────────────────────────────
describe('getGuestConversation', () => {
  beforeEach(() => mockMaybeSingle.mockReset());

  it('returns the conversation when found', async () => {
    const conv = { id: 'conv-99', context_id: 'guest:u1:org1' };
    mockMaybeSingle.mockResolvedValue({ data: conv, error: null });
    const result = await getGuestConversation('u1', 'org1');
    expect(result?.id).toBe('conv-99');
  });

  it('returns null when not found', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const result = await getGuestConversation('u1', 'org1');
    expect(result).toBeNull();
  });
});
