import { supabase } from '../../lib/supabase';

/**
 * Recruiting-Chat (Agentur ↔ Model nach Bewerbungsannahme).
 * Alle Threads und Nachrichten in Supabase:
 * - recruiting_chat_threads (pro model_application)
 * - recruiting_chat_messages – pro thread_id
 * Nur für die beteiligte Agentur und das zugehörige Model sichtbar.
 */
export type SupabaseRecruitingThread = {
  id: string;
  application_id: string;
  model_name: string;
  created_at: string;
};

export type SupabaseRecruitingMessage = {
  id: string;
  thread_id: string;
  from_role: 'agency' | 'model';
  text: string;
  created_at: string;
};

export async function getThreads(): Promise<SupabaseRecruitingThread[]> {
  const { data, error } = await supabase
    .from('recruiting_chat_threads')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { console.error('getThreads error:', error); return []; }
  return (data ?? []) as SupabaseRecruitingThread[];
}

export async function getThread(threadId: string): Promise<SupabaseRecruitingThread | null> {
  const { data, error } = await supabase
    .from('recruiting_chat_threads')
    .select('*')
    .eq('id', threadId)
    .maybeSingle();
  if (error) { console.error('getThread error:', error); return null; }
  return data as SupabaseRecruitingThread | null;
}

export async function createThread(applicationId: string, modelName: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('recruiting_chat_threads')
    .insert({ application_id: applicationId, model_name: modelName })
    .select('id')
    .single();
  if (error) { console.error('createThread error:', error); return null; }
  return data?.id ?? null;
}

export async function getMessages(threadId: string): Promise<SupabaseRecruitingMessage[]> {
  const { data, error } = await supabase
    .from('recruiting_chat_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  if (error) { console.error('getMessages error:', error); return []; }
  return (data ?? []) as SupabaseRecruitingMessage[];
}

export async function addMessage(threadId: string, fromRole: 'agency' | 'model', text: string): Promise<SupabaseRecruitingMessage | null> {
  const { data, error } = await supabase
    .from('recruiting_chat_messages')
    .insert({ thread_id: threadId, from_role: fromRole, text })
    .select()
    .single();
  if (error) { console.error('addMessage error:', error); return null; }
  return data as SupabaseRecruitingMessage;
}

export function subscribeToThreadMessages(
  threadId: string,
  onMessage: (msg: SupabaseRecruitingMessage) => void
) {
  const channel = supabase
    .channel(`recruiting-${threadId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'recruiting_chat_messages',
        filter: `thread_id=eq.${threadId}`,
      },
      (payload) => {
        onMessage(payload.new as SupabaseRecruitingMessage);
      }
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}
