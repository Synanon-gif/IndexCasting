import { createBookingMessageInClientAgencyChat } from '../bookingChatIntegrationSupabase';

const ensureClientAgencyChatMock = jest.fn();
const sendMessageMock = jest.fn();

jest.mock('../b2bOrgChatSupabase', () => ({
  ensureClientAgencyChat: (...args: any[]) => ensureClientAgencyChatMock(...args),
}));

jest.mock('../messengerSupabase', () => ({
  sendMessage: (...args: any[]) => sendMessageMock(...args),
}));

describe('createBookingMessageInClientAgencyChat', () => {
  beforeEach(() => {
    ensureClientAgencyChatMock.mockReset();
    sendMessageMock.mockReset();
  });

  it('inserts booking message with correct metadata', async () => {
    ensureClientAgencyChatMock.mockResolvedValue({
      ok: true,
      conversationId: 'conv-123',
      created: true,
    });

    sendMessageMock.mockResolvedValue({ id: 'msg-1' });

    const ok = await createBookingMessageInClientAgencyChat({
      agencyId: 'agency-1',
      actingUserId: 'user-1',
      clientOrganizationId: 'client-org-1',
      modelId: 'model-1',
      countryCode: 'de',
      date: '2026-03-23',
      optionRequestId: 'option-123',
    });

    expect(ok).toBe(true);
    expect(ensureClientAgencyChatMock).toHaveBeenCalledWith({
      agencyId: 'agency-1',
      actingUserId: 'user-1',
      clientOrganizationId: 'client-org-1',
    });
    expect(sendMessageMock).toHaveBeenCalledWith(
      'conv-123',
      'user-1',
      'Booking',
      undefined,
      undefined,
      expect.objectContaining({
        messageType: 'booking',
        metadata: {
          model_id: 'model-1',
          country_code: 'DE',
          date: '2026-03-23',
          status: 'pending',
          option_request_id: 'option-123',
        },
      }),
    );
  });
});
