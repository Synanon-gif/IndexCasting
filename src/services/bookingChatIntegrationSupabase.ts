import { ensureClientAgencyChat } from './b2bOrgChatSupabase';
import { sendMessage as sendMessengerMessage, type MessagePayloadType } from './messengerSupabase';

export type BookingChatMetadata = {
  model_id: string;
  country_code: string;
  date: string;
  status: 'pending';
};

export async function createBookingMessageInClientAgencyChat(params: {
  agencyId: string;
  actingUserId: string;
  clientOrganizationId: string;
  modelId: string;
  countryCode: string;
  date: string;
}): Promise<boolean> {
  const { agencyId, actingUserId, clientOrganizationId, modelId, countryCode, date } = params;

  try {
    if (!clientOrganizationId) return false;

    const ensured = await ensureClientAgencyChat({
      agencyId,
      actingUserId,
      clientOrganizationId,
    });

    if (!ensured.ok) {
      console.error('createBookingMessageInClientAgencyChat: ensure chat failed:', ensured.reason);
      return false;
    }

    const bookingMetadata: BookingChatMetadata = {
      model_id: modelId,
      country_code: countryCode.trim().toUpperCase(),
      date,
      status: 'pending',
    };

    const messageType: MessagePayloadType = 'booking';

    const msg = await sendMessengerMessage(
      ensured.conversationId,
      actingUserId,
      undefined,
      undefined,
      undefined,
      {
        messageType,
        metadata: bookingMetadata,
      },
    );

    return Boolean(msg?.id);
  } catch (e) {
    console.error('createBookingMessageInClientAgencyChat exception:', e);
    return false;
  }
}

