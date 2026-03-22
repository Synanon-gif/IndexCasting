/**
 * Build participant_ids for a client↔agency connection chat so org members can open the thread.
 */
import { supabase } from '../../lib/supabase';
import { getOrganizationIdForAgency, listOrganizationMembers } from './organizationsInvitationsSupabase';

export async function collectParticipantUserIdsForConnection(
  clientUserId: string,
  agencyId: string,
  acceptingAgencyUserId: string
): Promise<string[]> {
  const ids = new Set<string>([clientUserId, acceptingAgencyUserId]);

  try {
    const { data: clientRows } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', clientUserId);

    const clientOrgIds = [...new Set((clientRows ?? []).map((r: { organization_id: string }) => r.organization_id))];
    for (const orgId of clientOrgIds) {
      const { data: mems } = await supabase
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', orgId);
      (mems ?? []).forEach((m: { user_id: string }) => ids.add(m.user_id));
    }

    const agencyOrgId = await getOrganizationIdForAgency(agencyId);
    if (agencyOrgId) {
      const agencyMembers = await listOrganizationMembers(agencyOrgId);
      agencyMembers.forEach((m) => ids.add(m.user_id));
    }
  } catch (e) {
    console.error('collectParticipantUserIdsForConnection:', e);
  }

  return [...ids];
}
