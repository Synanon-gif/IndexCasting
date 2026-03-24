/**
 * Guest Chat Service
 *
 * Creates and manages conversations + messages for guest (Magic-Link) users.
 * Uses the existing conversations/messages tables — no new schema needed.
 *
 * Context ID pattern for guest chats: "guest:<guestUserId>:<agencyOrgId>"
 * This makes the conversation stable (idempotent) across sessions.
 */

import { supabase } from '../../lib/supabase';
import { type Conversation, type Message, sendMessage } from './messengerSupabase';

export type GuestBookingRequestPayload = {
  selected_models: string[];
  requested_date: string | null;
  message: string;
  guest_link_id?: string | null;
};

export type CreateGuestConversationResult =
  | { ok: true; conversation: Conversation; created: boolean }
  | { ok: false; reason: string };

/**
 * Builds a stable context_id for a guest ↔ agency conversation.
 * Sorting ensures the same ID regardless of parameter order.
 */
export function buildGuestChatContextId(
  guestUserId: string,
  agencyOrgId: string,
): string {
  return `guest:${guestUserId}:${agencyOrgId}`;
}

/**
 * Creates (or retrieves existing) a conversation between a guest user and
 * the agency members.
 *
 * participant_ids includes: guestUserId + all agencyParticipantIds
 * guest_user_id is set so the agency UI can label the chat as "Guest Client".
 */
export async function createGuestConversation(
  guestUserId: string,
  agencyOrgId: string,
  agencyParticipantIds: string[],
): Promise<CreateGuestConversationResult> {
  const contextId = buildGuestChatContextId(guestUserId, agencyOrgId);

  try {
    // Check for existing conversation with this context
    const { data: existing, error: findErr } = await supabase
      .from('conversations')
      .select('*')
      .eq('context_id', contextId)
      .maybeSingle();

    if (findErr) {
      console.error('createGuestConversation find error:', findErr);
    }

    if (existing) {
      return { ok: true, conversation: existing as Conversation, created: false };
    }

    const participantIds = Array.from(
      new Set([guestUserId, ...agencyParticipantIds].filter(Boolean)),
    );

    const { data, error } = await supabase
      .from('conversations')
      .insert({
        type: 'direct',
        context_id: contextId,
        participant_ids: participantIds,
        title: 'Guest Client',
        agency_organization_id: agencyOrgId,
        guest_user_id: guestUserId,
      })
      .select()
      .single();

    if (error) {
      // Handle race condition: another request just created the same conversation
      if (error.code === '23505' || /duplicate key/i.test(error.message)) {
        const { data: again } = await supabase
          .from('conversations')
          .select('*')
          .eq('context_id', contextId)
          .maybeSingle();
        if (again) {
          return { ok: true, conversation: again as Conversation, created: false };
        }
      }
      console.error('createGuestConversation insert error:', error);
      return { ok: false, reason: error.message };
    }

    return { ok: true, conversation: data as Conversation, created: true };
  } catch (e) {
    console.error('createGuestConversation exception:', e);
    return { ok: false, reason: 'Unexpected error creating guest conversation.' };
  }
}

/**
 * Sends the initial booking request message into the guest conversation.
 * message_type = 'booking_request' (stored as text, metadata carries structured data).
 */
export async function sendGuestBookingRequest(
  conversationId: string,
  guestUserId: string,
  payload: GuestBookingRequestPayload,
): Promise<Message | null> {
  try {
    const summary =
      payload.message.trim() ||
      `Booking request for ${payload.selected_models.length} model(s)${payload.requested_date ? ` on ${payload.requested_date}` : ''}.`;

    const message = await sendMessage(
      conversationId,
      guestUserId,
      summary,
      undefined,
      undefined,
      {
        messageType: 'booking_request' as 'booking',
        metadata: {
          selected_models: payload.selected_models,
          requested_date: payload.requested_date ?? null,
          message: payload.message,
          guest_link_id: payload.guest_link_id ?? null,
        },
      },
    );

    if (!message) {
      console.error('sendGuestBookingRequest: sendMessage returned null');
    }
    return message;
  } catch (e) {
    console.error('sendGuestBookingRequest exception:', e);
    return null;
  }
}

/**
 * Fetches the guest conversation for a given guestUserId + agencyOrgId.
 * Returns null if none exists yet.
 */
export async function getGuestConversation(
  guestUserId: string,
  agencyOrgId: string,
): Promise<Conversation | null> {
  const contextId = buildGuestChatContextId(guestUserId, agencyOrgId);
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('context_id', contextId)
      .maybeSingle();
    if (error) {
      console.error('getGuestConversation error:', error);
      return null;
    }
    return (data ?? null) as Conversation | null;
  } catch (e) {
    console.error('getGuestConversation exception:', e);
    return null;
  }
}

/**
 * Returns all agency member user IDs for a given agency organization.
 * Used to populate participant_ids in the guest conversation.
 */
export async function getAgencyMemberIds(agencyOrgId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', agencyOrgId);
    if (error) {
      console.error('getAgencyMemberIds error:', error);
      return [];
    }
    return (data ?? []).map((r: { user_id: string }) => r.user_id);
  } catch (e) {
    console.error('getAgencyMemberIds exception:', e);
    return [];
  }
}
