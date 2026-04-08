/**
 * Resolves human-readable copy for post-finalization success banner (after RPC success).
 */

import { supabase } from '../../lib/supabase';
import { uiCopy } from '../constants/uiCopy';
import type { InviteClaimSuccessPayload } from '../utils/inviteClaimSuccessBus';

export async function resolveInviteClaimSuccessMessage(
  payload: InviteClaimSuccessPayload,
  userId: string,
): Promise<string> {
  if (payload.kind === 'claim') {
    try {
      const { data: ag, error } = await supabase
        .from('agencies')
        .select('name')
        .eq('id', payload.agencyId)
        .maybeSingle();
      if (error) console.error('[resolveInviteClaimSuccessMessage] agency name:', error);
      const name = (ag as { name?: string | null } | null)?.name?.trim();
      if (name) {
        return uiCopy.inviteClaimSuccess.modelProfileConnectedWithAgency.replace('{agency}', name);
      }
    } catch (e) {
      console.error('[resolveInviteClaimSuccessMessage] claim branch exception:', e);
    }
    return uiCopy.inviteClaimSuccess.modelProfileConnected;
  }

  try {
    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', payload.organizationId)
      .maybeSingle();
    if (orgErr) console.error('[resolveInviteClaimSuccessMessage] org name:', orgErr);
    const orgName = (org as { name?: string | null } | null)?.name?.trim() ?? '';

    const { data: mem, error: memErr } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', payload.organizationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (memErr) console.error('[resolveInviteClaimSuccessMessage] member role:', memErr);

    const memberRole = (mem as { role?: string | null } | null)?.role;

    if (memberRole === 'booker') {
      return orgName
        ? uiCopy.inviteClaimSuccess.joinedOrgBooker.replace('{org}', orgName)
        : uiCopy.inviteClaimSuccess.joinedOrgFallback;
    }
    if (memberRole === 'employee') {
      return orgName
        ? uiCopy.inviteClaimSuccess.joinedOrgEmployee.replace('{org}', orgName)
        : uiCopy.inviteClaimSuccess.joinedOrgFallback;
    }
    if (orgName) {
      return uiCopy.inviteClaimSuccess.joinedOrgGeneric.replace('{org}', orgName);
    }
  } catch (e) {
    console.error('[resolveInviteClaimSuccessMessage] invite branch exception:', e);
  }
  return uiCopy.inviteClaimSuccess.joinedOrgFallback;
}

/** Single banner when org invite and model claim both succeed within the same finalize run (UI layer only). */
export async function resolveInviteAndClaimSuccessCombined(
  organizationId: string,
  claim: { modelId: string; agencyId: string },
  userId: string,
): Promise<string> {
  let orgName = '';
  let roleLabel: string = uiCopy.inviteClaimSuccess.combinedRoleTeamMember;
  try {
    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', organizationId)
      .maybeSingle();
    if (orgErr) console.error('[resolveInviteAndClaimSuccessCombined] org name:', orgErr);
    orgName = (org as { name?: string | null } | null)?.name?.trim() ?? '';

    const { data: mem, error: memErr } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (memErr) console.error('[resolveInviteAndClaimSuccessCombined] member role:', memErr);
    const memberRole = (mem as { role?: string | null } | null)?.role;
    if (memberRole === 'booker') roleLabel = uiCopy.inviteClaimSuccess.combinedRoleBooker;
    else if (memberRole === 'employee') roleLabel = uiCopy.inviteClaimSuccess.combinedRoleEmployee;
    else if (memberRole === 'owner') roleLabel = uiCopy.inviteClaimSuccess.combinedRoleOwner;
  } catch (e) {
    console.error('[resolveInviteAndClaimSuccessCombined] invite part exception:', e);
  }

  let agencyName = '';
  try {
    const { data: ag, error } = await supabase
      .from('agencies')
      .select('name')
      .eq('id', claim.agencyId)
      .maybeSingle();
    if (error) console.error('[resolveInviteAndClaimSuccessCombined] agency name:', error);
    agencyName = (ag as { name?: string | null } | null)?.name?.trim() ?? '';
  } catch (e) {
    console.error('[resolveInviteAndClaimSuccessCombined] claim part exception:', e);
  }

  if (orgName && agencyName) {
    return uiCopy.inviteClaimSuccess.joinedOrgAndModelWithAgency
      .replace('{org}', orgName)
      .replace('{role}', roleLabel)
      .replace('{agency}', agencyName);
  }
  if (orgName) {
    return uiCopy.inviteClaimSuccess.joinedOrgAndModel
      .replace('{org}', orgName)
      .replace('{role}', roleLabel);
  }
  return uiCopy.inviteClaimSuccess.joinedOrgAndModelFallback;
}
