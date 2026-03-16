/**
 * Context-aware chat service. Uses localApi (conversations + messages).
 * - Client <-> Agency: option negotiations (context = project / option request).
 * - Agency <-> Model: booking details (context = application / booking).
 * RLS: Only participants can read/write messages.
 */

import {
  getOrCreateOptionConversation,
  getOrCreateBookingConversation,
  getMessagesForConversation,
  addMessage as addMessageToDb,
  getConversationsForUser,
} from '../db/localApi';

const AGENCY_USER_ID = 'user-agent';
const CLIENT_USER_ID = 'user-client';

/** Get or create option conversation (Client–Agency) for a given context (e.g. option request). */
export function getOrCreateOptionChat(contextId: string, contextLabel: string) {
  return getOrCreateOptionConversation(CLIENT_USER_ID, AGENCY_USER_ID, contextId, contextLabel);
}

/** Get or create booking conversation (Agency–Model). */
export function getOrCreateBookingChat(
  modelUserId: string,
  contextId: string,
  contextLabel: string
) {
  return getOrCreateBookingConversation(AGENCY_USER_ID, modelUserId, contextId, contextLabel);
}

export function getChatMessages(conversationId: string, userId: string) {
  return getMessagesForConversation(conversationId, userId);
}

export function sendMessage(conversationId: string, senderId: string, receiverId: string, text: string) {
  return addMessageToDb(conversationId, senderId, receiverId, text);
}

export function getUserConversations(userId: string) {
  return getConversationsForUser(userId);
}
