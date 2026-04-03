/**
 * @deprecated This service uses the local mock API (localApi / localStorage) with
 * hardcoded demo user IDs. It is NOT connected to Supabase and has no real RLS.
 * It is kept only as a reference/demo scaffold and must NOT be used in production.
 * All real messaging goes through messengerSupabase.ts / recruitingChatSupabase.ts.
 */

import {
  getOrCreateOptionConversation,
  getOrCreateBookingConversation,
  getMessagesForConversation,
  addMessage as addMessageToDb,
  getConversationsForUser,
} from '../db/localApi';

const DEMO_AGENCY_USER_ID = 'user-agent';
const DEMO_CLIENT_USER_ID = 'user-client';

/** @deprecated Demo only — not connected to Supabase. */
export function getOrCreateOptionChat(contextId: string, contextLabel: string) {
  return getOrCreateOptionConversation(DEMO_CLIENT_USER_ID, DEMO_AGENCY_USER_ID, contextId, contextLabel);
}

/** @deprecated Demo only — not connected to Supabase. */
export function getOrCreateBookingChat(
  modelUserId: string,
  contextId: string,
  contextLabel: string
) {
  return getOrCreateBookingConversation(DEMO_AGENCY_USER_ID, modelUserId, contextId, contextLabel);
}

/** @deprecated Demo only — not connected to Supabase. */
export function getChatMessages(conversationId: string, userId: string) {
  return getMessagesForConversation(conversationId, userId);
}

/** @deprecated Demo only — not connected to Supabase. */
export function sendMessage(conversationId: string, senderId: string, receiverId: string, text: string) {
  return addMessageToDb(conversationId, senderId, receiverId, text);
}

/** @deprecated Demo only — not connected to Supabase. */
export function getUserConversations(userId: string) {
  return getConversationsForUser(userId);
}
