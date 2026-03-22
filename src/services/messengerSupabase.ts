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

export async function getConversationsForUser(userId: string): Promise<Conversation[]> {
  return fetchAllSupabasePages(async (from, to) => {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .contains('participant_ids', [userId])
      .order('updated_at', { ascending: false })
      .range(from, to);
    return { data: data as Conversation[] | null, error };
  });
}

export async function getConversationById(conversationId: string): Promise<Conversation | null> {
  try {
    const { data, error } = await supabase.from('conversations').select('*').eq('id', conversationId).maybeSingle();
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

export async function getOrCreateConversation(
  type: ConversationType,
  participantIds: string[],
  contextId?: string,
  title?: string,
  meta?: ConversationCreateMeta
): Promise<Conversation | null> {
  if (contextId) {
    const { data: existing } = await supabase
      .from('conversations')
      .select('*')
      .eq('type', type)
      .eq('context_id', contextId)
      .maybeSingle();
    if (existing) return existing as Conversation;
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
    console.error('getOrCreateConversation error:', error);
    return null;
  }
  return data as Conversation;
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  return fetchAllSupabasePages(async (from, to) => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .range(from, to);
    return { data: data as Message[] | null, error };
  });
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  text?: string,
  fileUrl?: string,
  fileType?: string
): Promise<Message | null> {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      text: text || null,
      file_url: fileUrl || null,
      file_type: fileType || null,
    })
    .select()
    .single();
  if (error) { console.error('sendMessage error:', error); return null; }

  await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);

  return data as Message;
}

export { formatSenderDisplayLine };

async function fetchProfilesForSenders(
  ids: string[]
): Promise<Record<string, { display_name: string | null; email: string | null; role: string | null }>> {
  if (ids.length === 0) return {};
  try {
    const { data, error } = await supabase.from('profiles').select('id, display_name, email, role').in('id', ids);
    if (error) {
      console.error('fetchProfilesForSenders error:', error);
      return {};
    }
    const map: Record<string, { display_name: string | null; email: string | null; role: string | null }> = {};
    for (const row of data ?? []) {
      const r = row as { id: string; display_name: string | null; email: string | null; role: string | null };
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
    const roleMap: Record<string, string> = {
      owner: 'Owner',
      booker: 'Booker',
      employee: 'Employee',
    };
    for (const row of data ?? []) {
      const r = row as { user_id: string; role: string };
      const label = roleMap[r.role] ?? r.role;
      if (result[r.user_id] === undefined) result[r.user_id] = label;
    }
    return result;
  } catch (e) {
    console.error('fetchOrgRoleLabelsForSenders exception:', e);
    return result;
  }
}

export async function getMessagesWithSenderInfo(conversationId: string): Promise<MessageWithSender[]> {
  try {
    const messages = await getMessages(conversationId);
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
      const name = p?.display_name?.trim() || p?.email?.trim() || 'User';
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
  await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .neq('sender_id', userId)
    .is('read_at', null);
}

export function subscribeToConversation(
  conversationId: string,
  onMessage: (msg: Message) => void
) {
  const channel = supabase
    .channel(`conversation-${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        onMessage(payload.new as Message);
      }
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

export async function uploadChatFile(
  conversationId: string,
  file: File | Blob,
  fileName: string
): Promise<string | null> {
  const path = `chat/${conversationId}/${Date.now()}_${fileName}`;
  const { error } = await supabase.storage
    .from('chat-files')
    .upload(path, file);
  if (error) { console.error('uploadChatFile error:', error); return null; }
  const { data } = supabase.storage.from('chat-files').getPublicUrl(path);
  return data.publicUrl;
}
