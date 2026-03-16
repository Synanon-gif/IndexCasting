/**
 * Einheitlicher Messenger-Service (Conversations + Messages).
 * Alle Chats und Anhänge in Supabase:
 * - conversations (participant_ids) – pro Nutzer über getConversationsForUser(userId)
 * - messages – pro conversation_id; Chat-Dateien in Storage (chat-files/chat/…)
 * Unterstützt Realtime-Subscriptions, Datei-Upload, Read-Receipts.
 */
import { supabase } from '../../lib/supabase';

export type ConversationType = 'option' | 'booking' | 'direct';

export type Conversation = {
  id: string;
  type: ConversationType;
  context_id: string | null;
  participant_ids: string[];
  title: string | null;
  created_at: string;
  updated_at: string;
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

export async function getConversationsForUser(userId: string): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .contains('participant_ids', [userId])
    .order('updated_at', { ascending: false });
  if (error) { console.error('getConversationsForUser error:', error); return []; }
  return (data ?? []) as Conversation[];
}

export async function getOrCreateConversation(
  type: ConversationType,
  participantIds: string[],
  contextId?: string,
  title?: string
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

  const { data, error } = await supabase
    .from('conversations')
    .insert({
      type,
      context_id: contextId || null,
      participant_ids: participantIds,
      title: title || null,
    })
    .select()
    .single();
  if (error) { console.error('getOrCreateConversation error:', error); return null; }
  return data as Conversation;
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) { console.error('getMessages error:', error); return []; }
  return (data ?? []) as Message[];
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
