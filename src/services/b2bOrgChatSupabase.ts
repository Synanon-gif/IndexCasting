/**
 * B2B org-to-org chats (client organization ↔ agency organization).
 * No connection/friendship rows — one `conversations` row per org pair (stable context_id).
 */
import { supabase } from '../../lib/supabase';
import { b2bOrgPairContextId } from '../utils/b2bOrgPairContextId';
import {
  getClientOrganizationIdForUser,
  getOrganizationIdForAgency,
  listOrganizationMembers,
} from './organizationsInvitationsSupabase';
import { getOrCreateConversation, type Conversation, type ConversationCreateMeta } from './messengerSupabase';
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

/**
 * Ensures a single B2B chat exists for the client user’s org and the agency.
 * Opens immediately — no pending/accept flow.
 */
export async function ensureClientAgencyChat(params: {
  clientUserId: string;
  agencyId: string;
  actingUserId: string;
}): Promise<EnsureClientAgencyChatResult> {
  const { clientUserId, agencyId, actingUserId } = params;

  const [clientOrgId, agencyOrgId] = await Promise.all([
    getClientOrganizationIdForUser(clientUserId),
    getOrganizationIdForAgency(agencyId),
  ]);

  if (!clientOrgId) {
    return { ok: false, reason: 'Client organization not found. Complete onboarding or invitations first.' };
  }
  if (!agencyOrgId) {
    return { ok: false, reason: 'Agency organization not found.' };
  }

  const existing = await findB2BConversationByOrgPair(clientOrgId, agencyOrgId);
  if (existing?.id) {
    return { ok: true, conversationId: existing.id, created: false };
  }

  const ctx = b2bOrgPairContextId(clientOrgId, agencyOrgId);
  const participantIds = await collectParticipantUserIdsForB2BPair(clientOrgId, agencyOrgId, [
    clientUserId,
    actingUserId,
  ]);

  const meta: ConversationCreateMeta = {
    createdBy: actingUserId,
    clientOrganizationId: clientOrgId,
    agencyOrganizationId: agencyOrgId,
  };

  const conv = await getOrCreateConversation('direct', participantIds, ctx, 'Client ↔ Agency', meta);
  if (!conv?.id) {
    const again = await findB2BConversationByOrgPair(clientOrgId, agencyOrgId);
    if (again?.id) return { ok: true, conversationId: again.id, created: false };
    return { ok: false, reason: 'Could not create chat. Check permissions (RLS) and try again.' };
  }

  return { ok: true, conversationId: conv.id, created: true };
}

/** All B2B org chats visible to members of this organization (either side of the pair). */
export async function listB2BConversationsForOrganization(organizationId: string): Promise<Conversation[]> {
  return fetchAllSupabasePages(async (from, to) => {
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
}

export async function getOrganizationName(orgId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('organizations').select('name').eq('id', orgId).maybeSingle();
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

/**
 * Title for inbox list: from agency perspective show client org name; from client show agency org name.
 */
export async function getB2BConversationTitleForViewer(params: {
  conversation: Conversation;
  viewerOrganizationId: string;
}): Promise<string> {
  const { conversation: c, viewerOrganizationId } = params;
  const clientOrg = c.client_organization_id ?? null;
  const agencyOrg = c.agency_organization_id ?? null;
  if (!clientOrg || !agencyOrg) return c.title?.trim() || 'Chat';

  const otherOrgId = viewerOrganizationId === clientOrg ? agencyOrg : clientOrg;
  const name = await getOrganizationName(otherOrgId);
  return name?.trim() || 'Organization';
}
