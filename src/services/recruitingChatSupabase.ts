import { supabase } from '../../lib/supabase';
import { uiCopy } from '../constants/uiCopy';

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
  agency_id: string | null;
  organization_id: string | null;
  created_by: string | null;
  created_at: string;
  /** 'recruiting' = vor Accept; 'active_model' = nach Accept. */
  chat_type: 'recruiting' | 'active_model' | null;
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

/** Latest thread for an application (heals orphaned threads if the app row was never linked). */
export async function findLatestThreadIdForApplication(applicationId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('recruiting_chat_threads')
      .select('id')
      .eq('application_id', applicationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('findLatestThreadIdForApplication error:', error);
      return null;
    }
    return (data as { id?: string } | null)?.id ?? null;
  } catch (e) {
    console.error('findLatestThreadIdForApplication exception:', e);
    return null;
  }
}

export async function createThread(
  applicationId: string,
  modelName: string,
  agencyId?: string | null,
  meta?: { organizationId?: string | null; createdBy?: string | null }
): Promise<string | null> {
  const payload: Record<string, unknown> = { application_id: applicationId, model_name: modelName };
  if (agencyId != null) payload.agency_id = agencyId;
  if (meta?.organizationId != null) payload.organization_id = meta.organizationId;
  if (meta?.createdBy != null) payload.created_by = meta.createdBy;
  const { data, error } = await supabase
    .from('recruiting_chat_threads')
    .insert(payload)
    .select('id')
    .single();
  if (error) { console.error('createThread error:', error); return null; }
  return data?.id ?? null;
}

/** Threads für eine Agentur (Booking Chats). */
export async function getThreadsForAgency(
  agencyId: string,
  options?: { createdByUserId?: string | null }
): Promise<SupabaseRecruitingThread[]> {
  let q = supabase
    .from('recruiting_chat_threads')
    .select('id, application_id, model_name, agency_id, organization_id, created_by, created_at')
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: false });
  if (options?.createdByUserId) {
    q = q.eq('created_by', options.createdByUserId);
  }
  const { data, error } = await q;
  if (error) { console.error('getThreadsForAgency error:', error); return []; }
  return (data ?? []) as SupabaseRecruitingThread[];
}

/** agency_id setzen (z. B. nach Accept, wenn Thread vorher ohne agency erstellt wurde). */
export async function updateThreadAgency(threadId: string, agencyId: string): Promise<boolean> {
  const { error } = await supabase
    .from('recruiting_chat_threads')
    .update({ agency_id: agencyId })
    .eq('id', threadId);
  if (error) { console.error('updateThreadAgency error:', error); return false; }
  return true;
}

/**
 * chat_type auf 'active_model' setzen, sobald die Agentur die Bewerbung angenommen hat.
 * Der Thread bleibt derselbe – nur das Label ändert sich.
 */
export async function updateThreadChatType(
  threadId: string,
  chatType: 'recruiting' | 'active_model',
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('recruiting_chat_threads')
      .update({ chat_type: chatType })
      .eq('id', threadId);
    if (error) {
      console.error('updateThreadChatType error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('updateThreadChatType exception:', e);
    return false;
  }
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

/**
 * Nur echte „Funktion fehlt / nicht im API-Schema“-Fälle.
 * Hinweis: PostgREST nutzt PGRST202 auch bei Signatur-/Parameter-Mismatch — das darf NICHT als „RPC fehlt“
 * gelten, sonst läuft der Client in einen wirkungslosen Fallback.
 */
export function isAgencyRecruitingChatRpcMissingError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  const msg = (e.message || '').toLowerCase();
  const namesThisRpc =
    msg.includes('agency_start_recruiting_chat') ||
    msg.includes('public.agency_start_recruiting_chat');
  if (!namesThisRpc) return false;
  return (
    msg.includes('schema cache') ||
    msg.includes('could not find') ||
    msg.includes('does not exist')
  );
}

/** PGRST202 mit anderem Text: oft falscher Funktionsname oder Argumente — kein Fallback als „fehlt“. */
export function isPgrst202Error(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  return (err as { code?: string }).code === 'PGRST202';
}

function collectErrText(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) {
    const x = err as Error & { details?: string; hint?: string; code?: string };
    return [x.message, x.details, x.hint, x.code].filter(Boolean).join(' ');
  }
  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const parts: string[] = [];
    for (const k of ['message', 'details', 'hint', 'code']) {
      const v = o[k];
      if (typeof v === 'string') parts.push(v);
    }
    const nested = o.cause ?? o.error;
    if (nested) parts.push(collectErrText(nested));
    const joined = parts.join(' ').trim();
    if (joined.length > 0) return joined;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/** Scalar uuid aus PostgREST / supabase-js normalisieren */
export function normalizeAgencyRecruitingChatRpcUuid(data: unknown): string | null {
  if (data == null) return null;
  if (typeof data === 'string') {
    const t = data.trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)
      ? t
      : null;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const u = normalizeAgencyRecruitingChatRpcUuid(item);
      if (u) return u;
    }
    return null;
  }
  if (typeof data === 'object' && data !== null) {
    const o = data as Record<string, unknown>;
    for (const k of ['agency_start_recruiting_chat', 'thread_id', 'id']) {
      const u = normalizeAgencyRecruitingChatRpcUuid(o[k]);
      if (u) return u;
    }
  }
  return null;
}

/** User-facing recruiting chat RPC errors — all strings sourced from uiCopy.recruiting. */
export function formatRecruitingChatRpcError(err: unknown): string {
  const raw = collectErrText(err);
  const msg = raw.toLowerCase();
  if (msg.includes('forbidden')) {
    return uiCopy.recruiting.chatForbidden;
  }
  if (msg.includes('wrong agency')) {
    return uiCopy.recruiting.chatWrongAgency;
  }
  if (msg.includes('not pending')) {
    return uiCopy.recruiting.chatNotPending;
  }
  if (msg.includes('not authenticated')) {
    return uiCopy.recruiting.chatSignInAgain;
  }
  if (msg.includes('application not found')) {
    return uiCopy.recruiting.chatApplicationNotFound;
  }
  if (msg.includes('failed to link')) {
    return uiCopy.recruiting.chatLinkFailed;
  }
  if (isPgrst202Error(err) && !isAgencyRecruitingChatRpcMissingError(err)) {
    return uiCopy.recruiting.chatSchemaMismatch;
  }
  if (msg.includes('internal server error') || msg.includes('internal_server_error')) {
    return uiCopy.recruiting.chatServerError;
  }
  if (msg.includes('permission denied') || msg.includes('42501')) {
    return uiCopy.recruiting.chatPermissionDenied;
  }
  if (msg.includes('does not exist') && msg.includes('function')) {
    return uiCopy.recruiting.chatFunctionMissing;
  }
  const detail = raw.replace(/\s+/g, ' ').trim();
  if (detail.length > 0) {
    return `Technical: ${detail.length > 320 ? `${detail.slice(0, 320)}…` : detail}`;
  }
  return uiCopy.recruiting.chatGenericFailed;
}

export type AgencyStartRecruitingChatRpcResult =
  | { status: 'ok'; threadId: string }
  | { status: 'missing_rpc' }
  | { status: 'error'; error: unknown };

/**
 * Atomar Thread anlegen/verknüpfen (SECURITY DEFINER) – für Agentur-Booker ohne RLS-Hänger.
 * Wenn die Funktion in der DB fehlt: status missing_rpc → Caller kann auf direkten Client-Pfad fallen.
 */
export async function agencyStartRecruitingChatRpc(
  applicationId: string,
  agencyId: string,
  modelName: string
): Promise<AgencyStartRecruitingChatRpcResult> {
  try {
    const { data, error } = await supabase.rpc('agency_start_recruiting_chat', {
      p_application_id: applicationId,
      p_agency_id: agencyId,
      p_model_name: modelName,
    });
    if (error) {
      if (isAgencyRecruitingChatRpcMissingError(error)) {
        return { status: 'missing_rpc' };
      }
      console.error('agencyStartRecruitingChatRpc error:', error);
      return { status: 'error', error };
    }
    const threadId = normalizeAgencyRecruitingChatRpcUuid(data);
    if (!threadId) {
      console.error('agencyStartRecruitingChatRpc: unexpected RPC data shape', data);
      return {
        status: 'error',
        error: new Error('empty thread id from agency_start_recruiting_chat'),
      };
    }
    return { status: 'ok', threadId };
  } catch (e) {
    console.error('agencyStartRecruitingChatRpc exception:', e);
    return { status: 'error', error: e };
  }
}
