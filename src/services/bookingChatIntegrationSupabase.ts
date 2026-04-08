import { ensureClientAgencyChat } from './b2bOrgChatSupabase';
import { sendMessage as sendMessengerMessage, type MessagePayloadType } from './messengerSupabase';
import { uiCopy } from '../constants/uiCopy';

export type BookingChatMetadata = {
  model_id: string;
  country_code: string;
  date: string;
  status: 'pending';
  /** Related option request thread id for contextual jump back. */
  option_request_id?: string;
  /** Set when the booking was initiated from a shared package. */
  source?: 'package';
  /** ID of the guest_links row the booking originated from. */
  package_id?: string;
};

export async function createBookingMessageInClientAgencyChat(params: {
  agencyId: string;
  actingUserId: string;
  clientOrganizationId: string;
  modelId: string;
  countryCode: string;
  date: string;
  optionRequestId?: string;
  source?: 'package';
  packageId?: string;
}): Promise<boolean> {
  const {
    agencyId,
    actingUserId,
    clientOrganizationId,
    modelId,
    countryCode,
    date,
    optionRequestId,
    source,
    packageId,
  } = params;

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
      ...(optionRequestId ? { option_request_id: optionRequestId } : {}),
      ...(source ? { source } : {}),
      ...(packageId ? { package_id: packageId } : {}),
    };

    const messageType: MessagePayloadType = 'booking';

    const msg = await sendMessengerMessage(
      ensured.conversationId,
      actingUserId,
      uiCopy.b2bChat.bookingCardTitle,
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
