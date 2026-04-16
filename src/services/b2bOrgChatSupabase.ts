/**
 * B2B org-to-org chats (client organization ↔ agency organization).
 * No connection/friendship rows — one `conversations` row per org pair (stable context_id).
 */
import { uiCopy } from '../constants/uiCopy';
import { supabase } from '../../lib/supabase';
import { b2bOrgPairContextId } from '../utils/b2bOrgPairContextId';
import { listOrganizationMembers } from './organizationsInvitationsSupabase';
import { type Conversation } from './messengerSupabase';
import { fetchAllSupabasePages } from './supabaseFetchAll';

export { b2bOrgPairContextId } from '../utils/b2bOrgPairContextId';

export async function collectParticipantUserIdsForB2BPair(
  clientOrgId: string,
  agencyOrgId: string,
  mustInclude: string[],
): Promise<string[]> {
  const ids = new Set<string>(mustInclude.filter(Boolean));

  try {
    const clientMembers = await listOrganizationMembers(clientOrgId);
    clientMembers.forEach((m) => ids.add(m.user_id));

    const agencyMembers = await listOrganizationMembers(agencyOrgId);
    agencyMembers.forEach((m) => ids.add(m.user_id));
  } catch (e) {
    console.error('collectParticipantUserIdsForB2BPair:', e);
  }

  return [...ids];
}

export async function findB2BConversationByOrgPair(
  clientOrgId: string,
  agencyOrgId: string,
): Promise<Conversation | null> {
  const ctx = b2bOrgPairContextId(clientOrgId, agencyOrgId);
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('type', 'direct')
      .eq('context_id', ctx)
      .maybeSingle();
    if (error) {
      console.error('findB2BConversationByOrgPair error:', error);
      return null;
    }
    return (data ?? null) as Conversation | null;
  } catch (e) {
    console.error('findB2BConversationByOrgPair exception:', e);
    return null;
  }
}

export type EnsureClientAgencyChatResult =
  | { ok: true; conversationId: string; created: boolean }
  | { ok: false; reason: string };

export type ResolveB2bOrgIdsResult =
  | { ok: true; client_org_id: string; agency_org_id: string }
  | { ok: false; error: string };

/** Server-side org resolution (SECURITY DEFINER). Required — RLS blocks cross-org reads from the client. */
/** When the agency picks a client *organization* (not a user). See migration_b2b_org_directory_and_pair_resolve.sql */
export async function resolveB2bOrgPairForChat(
  agencyId: string,
  clientOrganizationId: string,
): Promise<ResolveB2bOrgIdsResult> {
  try {
    const { data, error } = await supabase.rpc('resolve_b2b_org_pair_for_chat', {
      p_agency_id: agencyId,
      p_client_organization_id: clientOrganizationId,
    });
    if (error) {
      console.error('resolve_b2b_org_pair_for_chat error:', error);
      const msg = error.message || '';
      const code = (error as { code?: string }).code;
      if (
        code === 'PGRST202' ||
        /resolve_b2b_org_pair_for_chat|function .* does not exist/i.test(msg)
      ) {
        return { ok: false, error: 'migration_required' };
      }
      return { ok: false, error: msg };
    }
    const j = data as {
      ok?: boolean;
      error?: string;
      client_org_id?: string;
      agency_org_id?: string;
    };
    if (!j?.ok) return { ok: false, error: j?.error || 'rpc_failed' };
    const c = j.client_org_id;
    const a = j.agency_org_id;
    if (!c || !a) return { ok: false, error: 'missing_ids' };
    return { ok: true, client_org_id: c, agency_org_id: a };
  } catch (e) {
    console.error('resolveB2bOrgPairForChat exception:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

export async function resolveB2bChatOrganizationIds(
  clientUserId: string,
  agencyId: string,
): Promise<ResolveB2bOrgIdsResult> {
  try {
    const { data, error } = await supabase.rpc('resolve_b2b_chat_organization_ids', {
      p_client_user_id: clientUserId,
      p_agency_id: agencyId,
    });
    if (error) {
      console.error('resolve_b2b_chat_organization_ids error:', error);
      const msg = error.message || '';
      const code = (error as { code?: string }).code;
      if (
        code === 'PGRST202' ||
        /resolve_b2b_chat_organization_ids|function .* does not exist/i.test(msg)
      ) {
        return { ok: false, error: 'migration_required' };
      }
      return { ok: false, error: msg };
    }
    const j = data as {
      ok?: boolean;
      error?: string;
      client_org_id?: string;
      agency_org_id?: string;
    };
    if (!j?.ok) return { ok: false, error: j?.error || 'rpc_failed' };
    const c = j.client_org_id;
    const a = j.agency_org_id;
    if (!c || !a) return { ok: false, error: 'missing_ids' };
    return { ok: true, client_org_id: c, agency_org_id: a };
  } catch (e) {
    console.error('resolveB2bChatOrganizationIds exception:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

function mapCreateB2bRpcError(code: string | undefined): string {
  switch (code) {
    case 'not_authenticated':
      return uiCopy.alerts.signInRequired;
    case 'not_org_member':
    case 'invalid_params':
    case 'invalid_context':
    case 'unique_violation':
      return uiCopy.b2bChat.chatFailedGeneric;
    default:
      return code && code.length < 120 ? code : uiCopy.b2bChat.chatFailedGeneric;
  }
}

/**
 * Server-side insert (SECURITY DEFINER) — avoids fragile client INSERT RLS on `conversations`.
 */
export async function createB2bOrgConversationViaRpc(params: {
  contextId: string;
  clientOrgId: string;
  agencyOrgId: string;
  participantIds: string[];
  title: string;
}): Promise<
  { ok: true; conversationId: string; created: boolean } | { ok: false; reason: string }
> {
  try {
    const { data, error } = await supabase.rpc('create_b2b_org_conversation', {
      p_context_id: params.contextId,
      p_client_org_id: params.clientOrgId,
      p_agency_org_id: params.agencyOrgId,
      p_participant_ids: params.participantIds,
      p_title: params.title,
    });
    if (error) {
      console.error('create_b2b_org_conversation error:', error);
      const msg = error.message || '';
      const code = (error as { code?: string }).code;
      if (
        code === 'PGRST202' ||
        /create_b2b_org_conversation|function .* does not exist/i.test(msg)
      ) {
        return { ok: false, reason: uiCopy.b2bChat.migrationRequiredCreateB2bRpc };
      }
      return { ok: false, reason: msg || uiCopy.b2bChat.chatFailedGeneric };
    }
    const j = data as { ok?: boolean; conversation_id?: string; created?: boolean; error?: string };
    if (!j?.ok) {
      return { ok: false, reason: mapCreateB2bRpcError(j?.error) };
    }
    const id = j.conversation_id;
    if (!id) return { ok: false, reason: uiCopy.b2bChat.chatFailedGeneric };
    return { ok: true, conversationId: id, created: Boolean(j.created) };
  } catch (e) {
    console.error('createB2bOrgConversationViaRpc exception:', e);
    return { ok: false, reason: uiCopy.b2bChat.chatFailedGeneric };
  }
}

function mapResolveErrorToUi(code: string, opts?: { directoryRpc?: boolean }): string {
  switch (code) {
    case 'migration_required':
      return opts?.directoryRpc
        ? uiCopy.b2bChat.migrationRequiredB2bOrgDirectory
        : uiCopy.b2bChat.migrationRequiredResolveRpc;
    case 'invalid_client_org':
      return uiCopy.b2bChat.chatFailedGeneric;
    case 'client_org_missing':
      return uiCopy.b2bChat.ensureClientTargetNeedsOrg;
    case 'agency_org_missing':
      return uiCopy.b2bChat.ensureAgencyOrgMissing;
    case 'not_authenticated':
    case 'not_allowed':
    case 'caller_not_client':
    case 'missing_ids':
    case 'rpc_failed':
      return uiCopy.b2bChat.chatFailedGeneric;
    default:
      return code.length < 120 ? code : uiCopy.b2bChat.chatFailedGeneric;
  }
}

/**
 * Ensures a single B2B chat exists between a **client organization** and an **agency** (org-to-org).
 * Use either `clientUserId` (client browsing agencies) or `clientOrganizationId` (agency browsing clients), not both.
 */
export async function ensureClientAgencyChat(params: {
  agencyId: string;
  actingUserId: string;
  /** Client user — used when the client workspace starts a chat toward an agency. */
  clientUserId?: string;
  /** Client organization UUID — used when an agency team member starts a chat toward a client org. */
  clientOrganizationId?: string;
}): Promise<EnsureClientAgencyChatResult> {
  const { agencyId, actingUserId, clientUserId, clientOrganizationId } = params;

  if ((!clientUserId && !clientOrganizationId) || (clientUserId && clientOrganizationId)) {
    return { ok: false, reason: uiCopy.b2bChat.chatFailedGeneric };
  }

  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser.user || authUser.user.id !== actingUserId) {
    return { ok: false, reason: uiCopy.alerts.signInRequired };
  }

  const resolved = clientOrganizationId
    ? await resolveB2bOrgPairForChat(agencyId, clientOrganizationId)
    : await resolveB2bChatOrganizationIds(clientUserId!, agencyId);
  if (!resolved.ok) {
    if (resolved.error === 'client_org_missing' && clientUserId === actingUserId) {
      return { ok: false, reason: uiCopy.b2bChat.ensureClientOrgSelfFailed };
    }
    return {
      ok: false,
      reason: mapResolveErrorToUi(resolved.error, {
        directoryRpc: Boolean(clientOrganizationId),
      }),
    };
  }

  const clientOrgId = resolved.client_org_id;
  const agencyOrgId = resolved.agency_org_id;

  const existing = await findB2BConversationByOrgPair(clientOrgId, agencyOrgId);
  if (existing?.id) {
    return { ok: true, conversationId: existing.id, created: false };
  }

  const ctx = b2bOrgPairContextId(clientOrgId, agencyOrgId);
  const participantIds = await collectParticipantUserIdsForB2BPair(
    clientOrgId,
    agencyOrgId,
    clientOrganizationId ? [actingUserId] : [clientUserId!, actingUserId],
  );

  const authenticatedUid = authUser.user.id;
  const uniqueParticipants = [...new Set(participantIds.filter(Boolean))];
  if (!uniqueParticipants.includes(actingUserId)) {
    uniqueParticipants.push(actingUserId);
  }
  if (clientUserId && !uniqueParticipants.includes(clientUserId)) {
    uniqueParticipants.push(clientUserId);
  }
  if (!uniqueParticipants.includes(authenticatedUid)) {
    uniqueParticipants.unshift(authenticatedUid);
  }

  const created = await createB2bOrgConversationViaRpc({
    contextId: ctx,
    clientOrgId,
    agencyOrgId,
    participantIds: uniqueParticipants,
    title: 'Client ↔ Agency',
  });

  if (!created.ok) {
    const again = await findB2BConversationByOrgPair(clientOrgId, agencyOrgId);
    if (again?.id) return { ok: true, conversationId: again.id, created: false };
    return { ok: false, reason: created.reason };
  }

  return { ok: true, conversationId: created.conversationId, created: created.created };
}

/** All B2B org chats visible to members of this organization (either side of the pair). Dedupes by context_id. */
export async function listB2BConversationsForOrganization(
  organizationId: string,
): Promise<Conversation[]> {
  const all = await fetchAllSupabasePages(async (from, to) => {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('type', 'direct')
      .like('context_id', 'b2b:%')
      .or(`client_organization_id.eq.${organizationId},agency_organization_id.eq.${organizationId}`)
      .order('updated_at', { ascending: false })
      .range(from, to);
    return { data: data as Conversation[] | null, error };
  });
  const seen = new Set<string>();
  return all.filter((c) => {
    const key = c.context_id ?? c.id;
    if (seen.has(key)) {
      console.warn('[listB2BConversationsForOrganization] duplicate context_id filtered:', key);
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function getOrganizationName(orgId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .maybeSingle();
    if (error) {
      console.error('getOrganizationName error:', error);
      return null;
    }
    return (data as { name: string } | null)?.name ?? null;
  } catch (e) {
    console.error('getOrganizationName exception:', e);
    return null;
  }
}

const GENERIC_B2B_CONVERSATION_TITLE = /^client\s*[↔]\s*agency$/i;

/**
 * Title for inbox list: from agency perspective show client org name; from client show agency org name.
 * Uses SECURITY DEFINER RPC so the counterparty name resolves under org RLS (members cannot SELECT other org rows).
 */
export async function getB2BConversationTitleForViewer(params: {
  conversation: Conversation;
  viewerOrganizationId: string;
}): Promise<string> {
  const { conversation: c, viewerOrganizationId } = params;
  const clientOrg = c.client_organization_id ?? null;
  const agencyOrg = c.agency_organization_id ?? null;
  if (!clientOrg || !agencyOrg) {
    const t = c.title?.trim();
    if (t && !GENERIC_B2B_CONVERSATION_TITLE.test(t)) return t;
    return uiCopy.b2bChat.conversationFallback;
  }

  try {
    const { data, error } = await supabase.rpc('get_b2b_counterparty_org_name', {
      p_viewer_org_id: viewerOrganizationId,
      p_client_org_id: clientOrg,
      p_agency_org_id: agencyOrg,
    });
    if (error) {
      const msg = error.message || '';
      const code = (error as { code?: string }).code;
      if (
        code === 'PGRST202' ||
        /get_b2b_counterparty_org_name|function .* does not exist/i.test(msg)
      ) {
        console.error(
          'get_b2b_counterparty_org_name missing — run migration_b2b_counterparty_org_name_rpc.sql',
          error,
        );
      } else {
        console.error('get_b2b_counterparty_org_name error:', error);
      }
    } else if (typeof data === 'string') {
      const n = data.trim();
      if (n.length > 0) return n;
    }
  } catch (e) {
    console.error('getB2BConversationTitleForViewer rpc exception:', e);
  }

  const otherOrgId = viewerOrganizationId === clientOrg ? agencyOrg : clientOrg;
  const direct = await getOrganizationName(otherOrgId);
  if (direct?.trim()) return direct.trim();

  const fallbackTitle = c.title?.trim();
  if (fallbackTitle && !GENERIC_B2B_CONVERSATION_TITLE.test(fallbackTitle)) {
    return fallbackTitle;
  }

  return uiCopy.b2bChat.conversationFallback;
}

/**
 * Agency → Model direct chat: one stable conversation per agency–model pair.
 * Uses context_id = 'agency-model:{agencyId}:{modelId}'.
 * INSERT is covered by the existing "conversations_insert_participant" RLS policy
 * (actingUserId is always included in participant_ids).
 * SELECT for other agency members is covered by conversation_accessible_to_me
 * via agency_organization_id; the model accesses via participant_ids.
 */
export async function ensureAgencyModelDirectChat(params: {
  agencyId: string;
  agencyOrganizationId: string;
  modelId: string;
  modelUserId: string | null;
  actingUserId: string;
  modelName: string;
  /** Agency display name — stored as conversation title so the model can identify the agency. */
  agencyName: string;
}): Promise<
  { ok: true; conversationId: string; created: boolean } | { ok: false; reason: string }
> {
  const { agencyId, agencyOrganizationId, modelId, modelUserId, actingUserId, agencyName } = params;

  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser.user || authUser.user.id !== actingUserId) {
    return { ok: false, reason: uiCopy.alerts.signInRequired };
  }

  const contextId = `agency-model:${agencyId}:${modelId}`;

  try {
    const { data: existing, error: findErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('context_id', contextId)
      .maybeSingle();
    if (findErr) {
      console.error('ensureAgencyModelDirectChat find error:', findErr);
    }
    if (existing?.id) {
      return { ok: true, conversationId: existing.id as string, created: false };
    }
  } catch (e) {
    console.error('ensureAgencyModelDirectChat find exception:', e);
  }

  const participantIds = [...new Set([actingUserId, ...(modelUserId ? [modelUserId] : [])])];

  try {
    const { data, error } = await supabase
      .from('conversations')
      .insert({
        type: 'direct',
        context_id: contextId,
        participant_ids: participantIds,
        agency_organization_id: agencyOrganizationId,
        title: agencyName,
        created_by: actingUserId,
      })
      .select('id')
      .single();

    if (error) {
      console.error('ensureAgencyModelDirectChat insert error:', error);
      const { data: retry } = await supabase
        .from('conversations')
        .select('id')
        .eq('context_id', contextId)
        .maybeSingle();
      if (retry?.id) return { ok: true, conversationId: retry.id as string, created: false };
      return { ok: false, reason: uiCopy.b2bChat.chatFailedGeneric };
    }

    return { ok: true, conversationId: (data as { id: string }).id, created: true };
  } catch (e) {
    console.error('ensureAgencyModelDirectChat exception:', e);
    return { ok: false, reason: uiCopy.b2bChat.chatFailedGeneric };
  }
}

/**
 * Server find-or-create for agency↔model direct chat (`ensure_agency_model_direct_conversation`).
 * Models cannot rely on client INSERT into `conversations` when `agency_organization_id` is set (RLS).
 * Returns the conversation id, or null on error — no throw (Option A).
 */
export async function ensureAgencyModelDirectConversation(
  agencyId: string,
  modelId: string,
): Promise<string | null> {
  if (!agencyId?.trim() || !modelId?.trim()) {
    console.error('ensureAgencyModelDirectConversation: missing agencyId or modelId');
    return null;
  }
  try {
    const { data, error } = await supabase.rpc('ensure_agency_model_direct_conversation', {
      p_agency_id: agencyId,
      p_model_id: modelId,
    });
    if (error) {
      console.error('ensure_agency_model_direct_conversation RPC error:', error);
      return null;
    }
    const id = typeof data === 'string' ? data : data != null ? String(data) : '';
    return id || null;
  } catch (e) {
    console.error('ensureAgencyModelDirectConversation exception:', e);
    return null;
  }
}

/**
 * Same as {@link ensureAgencyModelDirectConversation} with a short retry after transient RPC/RLS lag.
 * Idempotent via server RPC — safe to call multiple times.
 */
export async function ensureAgencyModelDirectConversationWithRetry(
  agencyId: string,
  modelId: string,
  opts?: { attempts?: number; delayMs?: number },
): Promise<string | null> {
  const attempts = Math.max(1, Math.floor(opts?.attempts ?? 2));
  const delayMs = Math.max(0, opts?.delayMs ?? 280);
  let last: string | null = null;
  for (let i = 0; i < attempts; i++) {
    last = await ensureAgencyModelDirectConversation(agencyId, modelId);
    if (last) {
      if (i > 0) {
        console.warn('ensureAgencyModelDirectConversationWithRetry: succeeded after retry', {
          agencyId,
          modelId,
          attempt: i + 1,
        });
      }
      return last;
    }
    if (i < attempts - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  console.error('ensureAgencyModelDirectConversationWithRetry: exhausted attempts', {
    agencyId,
    modelId,
    attempts,
  });
  return last;
}

/**
 * Direct agency→model conversations visible to a specific model user.
 * The model is in participant_ids; RLS (conversation_accessible_to_me) grants access.
 */
export async function listModelAgencyDirectConversations(
  modelUserId: string,
): Promise<Conversation[]> {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .contains('participant_ids', [modelUserId])
      .like('context_id', 'agency-model:%')
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('listModelAgencyDirectConversations error:', error);
      return [];
    }
    return (data ?? []) as Conversation[];
  } catch (e) {
    console.error('listModelAgencyDirectConversations exception:', e);
    return [];
  }
}

/** All agency→model direct conversations for a given agency org (visible via agency_organization_id RLS). */
export async function listAgencyModelDirectConversations(
  agencyOrganizationId: string,
): Promise<Conversation[]> {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('agency_organization_id', agencyOrganizationId)
      .like('context_id', 'agency-model:%')
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('listAgencyModelDirectConversations error:', error);
      return [];
    }
    return (data ?? []) as Conversation[];
  } catch (e) {
    console.error('listAgencyModelDirectConversations exception:', e);
    return [];
  }
}
