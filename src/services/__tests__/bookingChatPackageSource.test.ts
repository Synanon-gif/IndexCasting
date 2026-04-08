/**
 * Tests for createBookingMessageInClientAgencyChat with package source context.
 * Verifies that source + package_id are correctly forwarded in the booking message metadata.
 */

const ensureClientAgencyChatMock = jest.fn();
const sendMessageMock = jest.fn();

jest.mock('../b2bOrgChatSupabase', () => ({
  ensureClientAgencyChat: (...args: unknown[]) => ensureClientAgencyChatMock(...args),
}));

jest.mock('../messengerSupabase', () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}));

import { createBookingMessageInClientAgencyChat, type BookingChatMetadata } from '../bookingChatIntegrationSupabase';

const BASE_PARAMS = {
  agencyId: 'agency-1',
  actingUserId: 'user-1',
  clientOrganizationId: 'client-org-1',
  modelId: 'model-1',
  countryCode: 'de',
  date: '2026-04-01',
};

describe('createBookingMessageInClientAgencyChat — package source', () => {
  beforeEach(() => {
    ensureClientAgencyChatMock.mockReset();
    sendMessageMock.mockReset();
    ensureClientAgencyChatMock.mockResolvedValue({ ok: true, conversationId: 'conv-1' });
    sendMessageMock.mockResolvedValue({ id: 'msg-1' });
  });

  it('does NOT include source or package_id in metadata when called without them', async () => {
    await createBookingMessageInClientAgencyChat(BASE_PARAMS);

    const callArgs = sendMessageMock.mock.calls[0];
    const passedMeta = (callArgs[5] as { metadata: BookingChatMetadata }).metadata;

    expect(passedMeta).not.toHaveProperty('source');
    expect(passedMeta).not.toHaveProperty('package_id');
    expect(passedMeta).not.toHaveProperty('option_request_id');
    expect(passedMeta.model_id).toBe('model-1');
    expect(passedMeta.status).toBe('pending');
  });

  it('includes source="package" in metadata when provided', async () => {
    await createBookingMessageInClientAgencyChat({
      ...BASE_PARAMS,
      source: 'package',
    });

    const callArgs = sendMessageMock.mock.calls[0];
    const passedMeta = (callArgs[5] as { metadata: BookingChatMetadata }).metadata;

    expect(passedMeta.source).toBe('package');
    expect(passedMeta).not.toHaveProperty('package_id');
  });

  it('includes both source and package_id when both are provided', async () => {
    await createBookingMessageInClientAgencyChat({
      ...BASE_PARAMS,
      source: 'package',
      packageId: 'guest-link-uuid-123',
    });

    const callArgs = sendMessageMock.mock.calls[0];
    const passedMeta = (callArgs[5] as { metadata: BookingChatMetadata }).metadata;

    expect(passedMeta.source).toBe('package');
    expect(passedMeta.package_id).toBe('guest-link-uuid-123');
  });

  it('normalises country_code to uppercase', async () => {
    await createBookingMessageInClientAgencyChat({
      ...BASE_PARAMS,
      source: 'package',
      packageId: 'pkg-1',
    });

    const passedMeta = (sendMessageMock.mock.calls[0][5] as { metadata: BookingChatMetadata }).metadata;
    expect(passedMeta.country_code).toBe('DE');
  });

  it('returns false and does not call sendMessage when ensureClientAgencyChat fails', async () => {
    ensureClientAgencyChatMock.mockResolvedValue({ ok: false, reason: 'not_found' });

    const result = await createBookingMessageInClientAgencyChat({
      ...BASE_PARAMS,
      source: 'package',
      packageId: 'pkg-2',
    });

    expect(result).toBe(false);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('uses message_type "booking"', async () => {
    await createBookingMessageInClientAgencyChat(BASE_PARAMS);

    const callArgs = sendMessageMock.mock.calls[0];
    const opts = callArgs[5] as { messageType: string };
    expect(opts.messageType).toBe('booking');
  });
});
