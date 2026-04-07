/**
 * Einheitlicher Messenger-Service (Conversations + Messages).
 * Alle Chats und Anhänge in Supabase:
 * - conversations (participant_ids) – pro Nutzer über getConversationsForUser(userId)
 * - messages – pro conversation_id; Chat-Dateien in Storage (chat-files/chat/…)
 * Unterstützt Realtime-Subscriptions, Datei-Upload, Read-Receipts.
 */
import { supabase } from '../../lib/supabase';
import { formatSenderDisplayLine } from '../utils/messengerSenderLabel';
import { fetchAllSupabasePages } from './supabaseFetchAll';
import { pooledSubscribe } from './realtimeChannelPool';
import { createNotifications } from './notificationsSupabase';
import { uiCopy } from '../constants/uiCopy';
import {
  validateText,
  sanitizeHtml,
  validateUrl,
  extractSafeUrls,
  validateFile,
  checkMagicBytes,
  checkExtensionConsistency,
  normalizeInput,
  CHAT_ALLOWED_MIME_TYPES,
  logSecurityEvent,
} from '../../lib/validation';
import { checkAndIncrementStorage, decrementStorage } from './agencyStorageSupabase';
import { convertHeicToJpegIfNeeded } from './imageUtils';
import { guardUploadSession } from './gdprComplianceSupabase';

/** Session key prefix for B2B messenger file uploads — pair with `confirmImageRights`. */
export const MESSENGER_UPLOAD_SESSION_PREFIX = 'messenger:';

export function buildMessengerUploadSessionKey(conversationId: string): string {
  return `${MESSENGER_UPLOAD_SESSION_PREFIX}${conversationId}`;
}

/** Reads the actual stored size of a chat file from storage.objects metadata. Best-effort — returns null on failure. */
async function getActualChatFileSize(bucket: string, path: string): Promise<number | null> {
  try {
    const folder = path.substring(0, path.lastIndexOf('/'));
    const filename = path.substring(path.lastIndexOf('/') + 1);
    const { data, error } = await supabase.storage.from(bucket).list(folder, { search: filename });
    if (error || !data?.length) return null;
    const size = data[0]?.metadata?.size;
    return typeof size === 'number' ? size : null;
  } catch {
    return null;
  }
}

/** Spezifische Felder für conversations — kein SELECT * mehr. */
const CONVERSATION_SELECT =
  'id, type, context_id, context_type, participant_ids, title, created_at, updated_at, created_by, client_organization_id, agency_organization_id, guest_user_id' as const;

/** Spezifische Felder für messages — kein SELECT * mehr. */
const MESSAGE_SELECT =
  'id, conversation_id, sender_id, text, file_url, file_type, read_at, created_at, message_type, metadata' as const;

export type ConversationType = 'option' | 'booking' | 'direct';

export type Conversation = {
  id: string;
  type: ConversationType;
  context_id: string | null;
  participant_ids: string[];
  title: string | null;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  client_organization_id?: string | null;
  agency_organization_id?: string | null;
  /** Set for guest (Magic-Link) conversations so the agency UI can label them "Guest Client". */
  guest_user_id?: string | null;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string | null;
  file_url: string | null;
  file_type: string | null;
  read_at: string | null;
  created_at: string;
  message_type?: MessagePayloadType | string | null;
  metadata?: Record<string, unknown> | null;
};

/** Message with resolved sender label for UI (English). */
export type MessageWithSender = Message & {
  senderLabel: string;
};

export type ConversationCreateMeta = {
  createdBy?: string | null;
  clientOrganizationId?: string | null;
  agencyOrganizationId?: string | null;
};

/** B2B chat message payload (maps to `messages.message_type` + `metadata`). */
export type MessagePayloadType = 'text' | 'link' | 'package' | 'model' | 'booking';

export async function getConversationsForUser(userId: string): Promise<Conversation[]> {
  return fetchAllSupabasePages(async (from, to) => {
    const { data, error } = await supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .contains('participant_ids', [userId])
      .order('updated_at', { ascending: false })
      .range(from, to);
    return { data: data as Conversation[] | null, error };
  });
}

export async function getConversationById(conversationId: string): Promise<Conversation | null> {
  try {
    const { data, error } = await supabase.from('conversations').select(CONVERSATION_SELECT).eq('id', conversationId).maybeSingle();
    if (error) {
      console.error('getConversationById error:', error);
      return null;
    }
    return (data ?? null) as Conversation | null;
  } catch (e) {
    console.error('getConversationById exception:', e);
    return null;
  }
}

export type GetOrCreateConversationResult =
  | { ok: true; conversation: Conversation }
  | { ok: false; errorMessage: string };

export async function getOrCreateConversation(
  type: ConversationType,
  participantIds: string[],
  contextId?: string,
  title?: string,
  meta?: ConversationCreateMeta
): Promise<GetOrCreateConversationResult> {
  if (contextId) {
    const { data: existing } = await supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('type', type)
      .eq('context_id', contextId)
      .maybeSingle();
    if (existing) return { ok: true, conversation: existing as Conversation };
  }

  const insertRow: Record<string, unknown> = {
    type,
    context_id: contextId || null,
    participant_ids: participantIds,
    title: title || null,
  };
  if (meta?.createdBy) insertRow.created_by = meta.createdBy;
  if (meta?.clientOrganizationId) insertRow.client_organization_id = meta.clientOrganizationId;
  if (meta?.agencyOrganizationId) insertRow.agency_organization_id = meta.agencyOrganizationId;

  const { data, error } = await supabase.from('conversations').insert(insertRow).select().single();
  if (error) {
    const code = (error as { code?: string }).code;
    const msg = error.message || '';
    const isDup =
      code === '23505' ||
      /duplicate key|unique constraint/i.test(msg);
    if (contextId && isDup) {
      const { data: again } = await supabase
        .from('conversations')
        .select(CONVERSATION_SELECT)
        .eq('type', type)
        .eq('context_id', contextId)
        .maybeSingle();
      if (again) return { ok: true, conversation: again as Conversation };
    }
    console.error('getOrCreateConversation error:', error);
    return { ok: false, errorMessage: msg || 'Unknown error' };
  }
  return { ok: true, conversation: data as Conversation };
}

/** Options for cursor-based message pagination. */
export type GetMessagesOptions = {
  /** Max number of messages to load. Defaults to 50. */
  limit?: number;
  /**
   * Cursor: ID of the oldest currently loaded message.
   * When provided, only messages older than this cursor are returned
   * ("Load more" / infinite scroll upward).
   */
  beforeId?: string;
};

/**
 * Loads the latest `limit` messages for a conversation in ascending order.
 * For subsequent "Load more" calls pass `beforeId` with the oldest loaded message ID.
 *
 * Replaces unbounded fetchAllSupabasePages (which loaded every message in memory).
 * At 500 agencies chatting simultaneously, each loading thousands of messages,
 * the old approach produced millions of DB rows in transit per minute.
 */
export async function getMessages(
  conversationId: string,
  opts?: GetMessagesOptions,
): Promise<Message[]> {
  const limit = opts?.limit ?? 50;
  try {
    let q = supabase
      .from('messages')
      .select(MESSAGE_SELECT)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (opts?.beforeId) {
      const { data: cursorRow } = await supabase
        .from('messages')
        .select('created_at')
        .eq('id', opts.beforeId)
        .maybeSingle();
      if (cursorRow) {
        q = q.lt('created_at', (cursorRow as { created_at: string }).created_at);
      }
    }

    const { data, error } = await q;
    if (error) { console.error('getMessages error:', error); return []; }
    // Reverse DESC result back to ascending order for rendering
    return ((data ?? []) as Message[]).reverse();
  } catch (e) {
    console.error('getMessages exception:', e);
    return [];
  }
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  text?: string,
  fileUrl?: string,
  fileType?: string,
  opts?: {
    messageType?: MessagePayloadType;
    metadata?: Record<string, unknown> | null;
  }
): Promise<Message | null> {
  // Validate and sanitize text content before storage
  let safeText: string | null = null;
  if (text != null && text.trim().length > 0) {
    // Normalize first: strip invisible chars, collapse repetition, NFC
    const normalized = normalizeInput(text);

    const textCheck = validateText(normalized, { maxLength: 2000, allowEmpty: false });
    if (!textCheck.ok) {
      console.warn('sendMessage: text validation failed', textCheck.error);
      void logSecurityEvent({ type: 'large_payload', userId: senderId, metadata: { service: 'messengerSupabase', field: 'text' } });
      return null;
    }
    // Sanitize to strip any injected HTML/scripts; content stored as safe plain text
    safeText = sanitizeHtml(normalized);

    // Validate any URLs present in the message
    const urls = extractSafeUrls(normalized);
    const allUrlsInText = normalized.match(/https?:\/\/[^\s]+/gi) ?? [];
    if (allUrlsInText.length > urls.length) {
      console.warn('sendMessage: message contains unsafe URLs');
      void logSecurityEvent({ type: 'invalid_url', userId: senderId, metadata: { service: 'messengerSupabase' } });
      return null;
    }
    // Explicit link metadata URL also validated
    const metaUrl = opts?.metadata?.url;
    if (typeof metaUrl === 'string') {
      const urlCheck = validateUrl(metaUrl);
      if (!urlCheck.ok) {
        console.warn('sendMessage: metadata URL failed validation', urlCheck.error);
        void logSecurityEvent({ type: 'invalid_url', userId: senderId, metadata: { service: 'messengerSupabase', field: 'metadata.url' } });
        return null;
      }
    }
  }

  const insertRow: Record<string, unknown> = {
    conversation_id: conversationId,
    sender_id: senderId,
    text: safeText,
    file_url: fileUrl ?? null,
    file_type: fileType ?? null,
    message_type: opts?.messageType ?? 'text',
  };
  if (opts?.metadata !== undefined) insertRow.metadata = opts.metadata;

  const { data, error } = await supabase.from('messages').insert(insertRow).select().single();
  if (error) { console.error('sendMessage error:', error); return null; }

  await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);

  // Notify all participants except the sender
  void notifyConversationParticipants(conversationId, senderId);

  return data as Message;
}

export { formatSenderDisplayLine };

/**
 * Creates a "new_message" notification for every conversation participant
 * except the sender. Fire-and-forget — never throws.
 */
async function notifyConversationParticipants(
  conversationId: string,
  senderId: string,
): Promise<void> {
  try {
    const conv = await getConversationById(conversationId);
    if (!conv) return;
    const recipients = (conv.participant_ids ?? []).filter((id) => id !== senderId);
    if (recipients.length === 0) return;
    await createNotifications(
      recipients.map((userId) => ({
        user_id: userId,
        type: 'new_message',
        title: uiCopy.notifications.newMessage.title,
        message: uiCopy.notifications.newMessage.message,
        metadata: { conversation_id: conversationId },
      })),
    );
  } catch (e) {
    console.error('notifyConversationParticipants exception:', e);
  }
}

async function fetchProfilesForSenders(
  ids: string[]
): Promise<Record<string, { display_name: string | null; role: string | null }>> {
  if (ids.length === 0) return {};
  try {
    const { data, error } = await supabase.from('profiles').select('id, display_name, role').in('id', ids);
    if (error) {
      console.error('fetchProfilesForSenders error:', error);
      return {};
    }
    const map: Record<string, { display_name: string | null; role: string | null }> = {};
    for (const row of data ?? []) {
      const r = row as { id: string; display_name: string | null; role: string | null };
      map[r.id] = r;
    }
    return map;
  } catch (e) {
    console.error('fetchProfilesForSenders exception:', e);
    return {};
  }
}

async function fetchOrgRoleLabelsForSenders(
  senderIds: string[],
  clientOrgId: string | null,
  agencyOrgId: string | null
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const orgIds = [clientOrgId, agencyOrgId].filter(Boolean) as string[];
  if (orgIds.length === 0 || senderIds.length === 0) return result;
  try {
    const { data, error } = await supabase
      .from('organization_members')
      .select('user_id, role, organization_id')
      .in('user_id', senderIds)
      .in('organization_id', orgIds);
    if (error) {
      console.error('fetchOrgRoleLabelsForSenders error:', error);
      return result;
    }
    const rows = (data ?? []) as { user_id: string; role: string; organization_id: string }[];
    const byUser = new Map<string, typeof rows>();
    for (const row of rows) {
      const arr = byUser.get(row.user_id) ?? [];
      arr.push(row);
      byUser.set(row.user_id, arr);
    }
    for (const uid of senderIds) {
      const memb = byUser.get(uid) ?? [];
      const clientMem = memb.find((m) => Boolean(clientOrgId && m.organization_id === clientOrgId));
      const agencyMem = memb.find((m) => Boolean(agencyOrgId && m.organization_id === agencyOrgId));
      let label: string | null = null;
      if (clientMem) {
        if (clientMem.role === 'employee') label = 'Client';
        else if (clientMem.role === 'owner') label = 'Owner';
        else label = clientMem.role;
      } else if (agencyMem) {
        if (agencyMem.role === 'booker') label = 'Booker';
        else if (agencyMem.role === 'owner') label = 'Owner';
        else label = agencyMem.role;
      }
      if (label) result[uid] = label;
    }
    return result;
  } catch (e) {
    console.error('fetchOrgRoleLabelsForSenders exception:', e);
    return result;
  }
}

export async function getMessagesWithSenderInfo(
  conversationId: string,
  opts?: GetMessagesOptions,
): Promise<MessageWithSender[]> {
  try {
    const messages = await getMessages(conversationId, opts);
    const conv = await getConversationById(conversationId);
    const senderIds = [...new Set(messages.map((m) => m.sender_id))];
    const profiles = await fetchProfilesForSenders(senderIds);
    const orgLabels = await fetchOrgRoleLabelsForSenders(
      senderIds,
      conv?.client_organization_id ?? null,
      conv?.agency_organization_id ?? null
    );
    return messages.map((m) => {
      const p = profiles[m.sender_id];
      const name = p?.display_name?.trim() || 'User';
      const orgRole = orgLabels[m.sender_id] ?? null;
      const profileRole = p?.role ?? null;
      return {
        ...m,
        senderLabel: formatSenderDisplayLine(name, orgRole, profileRole),
      };
    });
  } catch (e) {
    console.error('getMessagesWithSenderInfo exception:', e);
    return [];
  }
}

export async function markAsRead(messageId: string): Promise<boolean> {
  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('id', messageId)
    .is('read_at', null);
  if (error) { console.error('markAsRead error:', error); return false; }
  return true;
}

export async function markAllAsRead(conversationId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .neq('sender_id', userId)
    .is('read_at', null);
  if (error) console.error('markAllAsRead error:', error);
}

/**
 * Subscribe to new messages in a conversation.
 * Uses the shared channel pool — opening the same conversation from multiple
 * components reuses one WebSocket channel instead of creating duplicates.
 * Returns a cleanup function (call on unmount / useFocusEffect cleanup).
 */
export function subscribeToConversation(
  conversationId: string,
  onMessage: (msg: Message) => void,
): () => void {
  return pooledSubscribe(
    `conversation-${conversationId}`,
    (channel, dispatch) =>
      channel
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `conversation_id=eq.${conversationId}`,
          },
          dispatch,
        )
        .subscribe(),
    (payload) => onMessage((payload as { new: Message }).new),
  );
}

/**
 * Uploads a file to the private chat-files bucket and returns the storage path.
 * The bucket MUST be set to private in the Supabase dashboard.
 * Use getSignedChatFileUrl() to generate time-limited download URLs for display.
 *
 * Validates MIME type, file size, and magic bytes before upload.
 * Call {@link confirmImageRights} with `sessionKey` = {@link buildMessengerUploadSessionKey}
 * before this; this function enforces {@link guardUploadSession} (client-side DB check).
 */
export async function uploadChatFile(
  conversationId: string,
  file: File | Blob,
  fileName: string
): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    console.warn('uploadChatFile: not authenticated');
    return null;
  }
  const sessionKey = buildMessengerUploadSessionKey(conversationId);
  const rights = await guardUploadSession(auth.user.id, sessionKey);
  if (!rights.ok) {
    console.warn('uploadChatFile: image rights confirmation required', sessionKey);
    return null;
  }

  // Convert HEIC/HEIF to JPEG before validation
  file = await convertHeicToJpegIfNeeded(file);
  // MIME type + size check
  const mimeCheck = validateFile(file, CHAT_ALLOWED_MIME_TYPES);
  if (!mimeCheck.ok) {
    console.warn('uploadChatFile: file validation failed', mimeCheck.error);
    void logSecurityEvent({ type: 'file_rejected', metadata: { service: 'messengerSupabase', reason: 'mime' } });
    return null;
  }
  // Magic byte check — prevents renamed executables
  const magicCheck = await checkMagicBytes(file);
  if (!magicCheck.ok) {
    console.warn('uploadChatFile: magic bytes check failed', magicCheck.error);
    void logSecurityEvent({ type: 'magic_bytes_fail', metadata: { service: 'messengerSupabase' } });
    return null;
  }
  // Extension consistency check — MIME + magic bytes + extension must align
  const extCheck = checkExtensionConsistency(file);
  if (!extCheck.ok) {
    console.warn('uploadChatFile: extension consistency check failed', extCheck.error);
    void logSecurityEvent({ type: 'extension_mismatch', metadata: { service: 'messengerSupabase' } });
    return null;
  }

  // Agency storage limit check — non-agency users pass through automatically.
  const storageCheck = await checkAndIncrementStorage(file.size);
  if (!storageCheck.allowed) {
    console.warn('uploadChatFile: storage limit reached', storageCheck);
    return null;
  }

  const claimedSize = file instanceof File ? file.size : (file as Blob).size;
  const path = `chat/${conversationId}/${Date.now()}_${fileName}`;
  const { error } = await supabase.storage
    .from('chat-files')
    .upload(path, file);
  if (error) {
    console.error('uploadChatFile error:', error);
    await decrementStorage(claimedSize);
    return null;
  }

  // BUG 3 FIX: read actual size from storage.objects post-upload and reconcile
  // any drift between the client-reported size and what was actually stored.
  const actualSize = await getActualChatFileSize('chat-files', path) ?? claimedSize;
  if (actualSize !== claimedSize) {
    if (actualSize > claimedSize) {
      const driftResult = await checkAndIncrementStorage(actualSize - claimedSize);
      if (!driftResult.allowed) {
        console.warn('[storage] uploadChatFile: post-upload size drift exceeded limit — counter undercounted', { actualSize, claimedSize });
      }
    } else {
      await decrementStorage(claimedSize - actualSize);
    }
  }

  return path;
}

/**
 * Creates a time-limited signed URL for a chat file stored in the private bucket.
 * Call this whenever you need to display/download a file attachment.
 * @param pathOrLegacyUrl – storage path (new) or a legacy public URL (old rows)
 * @param expiresInSeconds – URL validity window; default 1 hour
 */
export async function getSignedChatFileUrl(
  pathOrLegacyUrl: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  if (!pathOrLegacyUrl) return null;

  // Legacy rows stored the full public URL; detect and extract the path.
  const storagePath = pathOrLegacyUrl.includes('/storage/v1/object/public/chat-files/')
    ? pathOrLegacyUrl.split('/storage/v1/object/public/chat-files/')[1]
    : pathOrLegacyUrl;

  try {
    const { data, error } = await supabase.storage
      .from('chat-files')
      .createSignedUrl(storagePath, expiresInSeconds);
    if (error) { console.error('getSignedChatFileUrl error:', error); return null; }
    return data.signedUrl;
  } catch (e) {
    console.error('getSignedChatFileUrl exception:', e);
    return null;
  }
}
