import { Platform } from 'react-native';
import { supabase } from '../../lib/supabase';
import { serviceErr, serviceOk, type ServiceResult } from '../types/serviceResult';
import { buildInviteAbsoluteUrl, buildInviteDeepLinkPath } from './inviteUrlHelpers';
import { uiCopy } from '../constants/uiCopy';
import { isValidRoleForOrgType, type OrganizationType, type OrgMemberRole } from './orgRoleTypes';
import { logAction } from '../utils/logAction';

export type { OrganizationType, OrgMemberRole };
export type InvitationRole = 'booker' | 'employee';
export type InvitationStatus = 'pending' | 'accepted';

export type OrganizationRow = {
  id: string;
  name: string;
  type: OrganizationType;
  owner_id: string;
  agency_id: string | null;
  created_at: string;
};

export type OrganizationMemberRow = {
  id: string;
  user_id: string;
  organization_id: string;
  role: OrgMemberRole;
  created_at: string;
};

export type InvitationRow = {
  id: string;
  email: string;
  organization_id: string;
  role: InvitationRole;
  invited_by: string | null;
  status: InvitationStatus;
  token: string;
  created_at: string;
  expires_at: string;
};

export type CreateOrganizationInvitationResult =
  | { ok: true; invitation: InvitationRow }
  | {
      ok: false;
      error:
        | 'agency_member_limit_reached'
        | 'already_invited'
        | 'already_member'
        | 'owner_only'
        | 'unknown';
    };
type CreateOrganizationInvitationError = Exclude<
  CreateOrganizationInvitationResult,
  { ok: true }
>['error'];

export type InvitationPreview = {
  org_name: string;
  org_type: OrganizationType;
  invite_role: InvitationRole;
  expires_at: string;
  /** Maskierte E-Mail-Adresse der Einladung, z.B. "b***@agency.com". Zeigt dem User vor der Registrierung welche E-Mail er verwenden muss. */
  invited_email_hint?: string | null;
};

function randomInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function buildOrganizationInviteUrl(token: string): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return buildInviteAbsoluteUrl(window.location.origin, window.location.pathname || '/', token);
  }
  return buildInviteDeepLinkPath(token);
}

export async function ensureAgencyOrganization(agencyId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('ensure_agency_organization', {
      p_agency_id: agencyId,
    });
    if (error) {
      console.error('ensureAgencyOrganization error:', error);
      return null;
    }
    return typeof data === 'string' ? data : null;
  } catch (e) {
    console.error('ensureAgencyOrganization exception:', e);
    return null;
  }
}

export async function ensureClientOrganization(): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('ensure_client_organization', {});
    if (error) {
      console.error('ensureClientOrganization error:', error);
      return null;
    }
    return typeof data === 'string' ? data : null;
  } catch (e) {
    console.error('ensureClientOrganization exception:', e);
    return null;
  }
}

export async function getInvitationPreview(token: string): Promise<InvitationPreview | null> {
  try {
    const { data, error } = await supabase.rpc('get_invitation_preview', { p_token: token });
    if (error) {
      console.error('getInvitationPreview error:', error);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.org_name) return null;
    return {
      org_name: row.org_name,
      org_type: row.org_type as OrganizationType,
      invite_role: row.invite_role as InvitationRole,
      expires_at: row.expires_at,
      invited_email_hint: row.invited_email_hint ?? null,
    };
  } catch (e) {
    console.error('getInvitationPreview exception:', e);
    return null;
  }
}

export async function acceptOrganizationInvitation(token: string): Promise<{
  ok: boolean;
  error?: string;
  organization_id?: string;
}> {
  try {
    const { data, error } = await supabase.rpc('accept_organization_invitation', {
      p_token: token,
    });
    if (error) {
      console.error('acceptOrganizationInvitation error:', error);
      return { ok: false, error: error.message };
    }
    const j = data as { ok?: boolean; error?: string; organization_id?: string };
    if (!j?.ok) return { ok: false, error: j?.error || 'failed' };
    return { ok: true, organization_id: j.organization_id };
  } catch (e) {
    console.error('acceptOrganizationInvitation exception:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

export async function listOrganizationMembers(
  organizationId: string,
): Promise<Array<OrganizationMemberRow & { display_name: string | null; email: string | null }>> {
  try {
    const { data: members, error } = await supabase
      .from('organization_members')
      .select('id, user_id, organization_id, role, created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('listOrganizationMembers error:', error);
      return [];
    }
    const rows = (members ?? []) as OrganizationMemberRow[];
    if (rows.length === 0) return [];

    const userIds = rows.map((m) => m.user_id);

    // display_name is granted directly to authenticated on profiles (not sensitive).
    // Fetch it independently so the member list always shows names, even if the
    // email RPC is unavailable.
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', userIds);
    const displayNameMap = new Map(
      ((profileRows ?? []) as { id: string; display_name: string | null }[]).map((p) => [
        p.id,
        p.display_name,
      ]),
    );

    // Use the SECURITY DEFINER RPC only for email (column-level restricted).
    const { data: memberEmails, error: emailErr } = await supabase.rpc('get_org_member_emails', {
      p_org_id: organizationId,
    });
    if (emailErr) console.error('listOrganizationMembers email RPC error:', emailErr);
    const emailMap = new Map(
      ((memberEmails ?? []) as { user_id: string; email: string | null }[]).map((r) => [
        r.user_id,
        r.email,
      ]),
    );

    return rows.map((m) => ({
      ...m,
      display_name: displayNameMap.get(m.user_id) ?? null,
      email: emailMap.get(m.user_id) ?? null,
    }));
  } catch (e) {
    console.error('listOrganizationMembers exception:', e);
    return [];
  }
}

export async function listInvitationsForOrganization(
  organizationId: string,
): Promise<InvitationRow[]> {
  try {
    const { data, error } = await supabase
      .from('invitations')
      .select('id, email, organization_id, role, invited_by, status, token, created_at, expires_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('listInvitationsForOrganization error:', error);
      return [];
    }
    return (data ?? []) as InvitationRow[];
  } catch (e) {
    console.error('listInvitationsForOrganization exception:', e);
    return [];
  }
}

export async function createOrganizationInvitation(params: {
  organizationId: string;
  email: string;
  role: InvitationRole;
  ttlHours?: number;
}): Promise<CreateOrganizationInvitationResult> {
  const classifyCreateInviteError = (raw: string): CreateOrganizationInvitationError => {
    const msg = raw.toLowerCase();
    if (msg.includes('agency_member_limit_reached')) return 'agency_member_limit_reached';
    if (msg.includes('owner_only') || msg.includes('not_owner')) return 'owner_only';
    if (msg.includes('already_invited') || msg.includes('invitation_already_exists'))
      return 'already_invited';
    if (msg.includes('already_member') || msg.includes('member_exists')) return 'already_member';
    // Defensive fallback for common DB uniqueness signatures.
    if (msg.includes('duplicate key') && msg.includes('invitation')) return 'already_invited';
    return 'unknown';
  };

  try {
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      console.error('createOrganizationInvitation: no user', userErr);
      return { ok: false, error: 'unknown' };
    }

    // Org-Typ laden und Rollen-Gültigkeit vor dem DB-Insert prüfen.
    // Verhindert, dass booker in Client-Orgs oder employee in Agency-Orgs eingeladen werden.
    const org = await getOrganizationById(params.organizationId);
    if (!org) {
      console.error('createOrganizationInvitation: organization not found', params.organizationId);
      return { ok: false, error: 'unknown' };
    }
    if (!isValidRoleForOrgType(params.role, org.type)) {
      console.error(
        `createOrganizationInvitation: role "${params.role}" is not valid for ${org.type} organizations`,
      );
      return { ok: false, error: 'unknown' };
    }

    const ttl = params.ttlHours ?? 48;
    const expires = new Date(Date.now() + ttl * 60 * 60 * 1000).toISOString();
    const token = randomInviteToken();
    const { data, error } = await supabase
      .from('invitations')
      .insert({
        email: params.email.trim().toLowerCase(),
        organization_id: params.organizationId,
        role: params.role,
        invited_by: userData.user.id,
        status: 'pending',
        token,
        expires_at: expires,
      })
      .select('id, email, organization_id, role, invited_by, status, token, created_at, expires_at')
      .single();
    if (error) {
      console.error('createOrganizationInvitation error:', error);
      const msg = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`;
      return { ok: false, error: classifyCreateInviteError(msg) };
    }
    const invitation = data as InvitationRow;
    logAction(params.organizationId, 'createOrganizationInvitation', {
      type: 'audit',
      action: 'member_invited',
      entityType: 'invitation',
      entityId: invitation.id,
      newData: { email: params.email, role: params.role, invited_by: userData.user.id },
    });
    return { ok: true, invitation };
  } catch (e) {
    console.error('createOrganizationInvitation exception:', e);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: classifyCreateInviteError(msg) };
  }
}

export async function getMyClientMemberRole(): Promise<{
  member_role: OrgMemberRole;
  organization_id: string;
} | null> {
  try {
    const { data, error } = await supabase.rpc('get_my_client_member_role');
    if (error) {
      console.error('getMyClientMemberRole error:', error);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.organization_id) return null;
    return {
      member_role: row.member_role as OrgMemberRole,
      organization_id: row.organization_id,
    };
  } catch (e) {
    console.error('getMyClientMemberRole exception:', e);
    return null;
  }
}

export async function getMyAgencyMemberRole(
  agencyId: string,
): Promise<{ member_role: OrgMemberRole; organization_id: string } | null> {
  try {
    const { data, error } = await supabase.rpc('get_my_agency_member_role', {
      p_agency_id: agencyId,
    });
    if (error) {
      console.error('getMyAgencyMemberRole error:', error);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.organization_id) return null;
    return {
      member_role: row.member_role as OrgMemberRole,
      organization_id: row.organization_id,
    };
  } catch (e) {
    console.error('getMyAgencyMemberRole exception:', e);
    return null;
  }
}

export async function getOrganizationIdForAgency(agencyId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('organizations')
      .select('id')
      .eq('agency_id', agencyId)
      .maybeSingle();
    if (error) {
      console.error('getOrganizationIdForAgency error:', error);
      return null;
    }
    return (data as { id: string } | null)?.id ?? null;
  } catch (e) {
    console.error('getOrganizationIdForAgency exception:', e);
    return null;
  }
}

/** Reverse of getOrganizationIdForAgency — resolves agencies.id from organizations.id. */
export async function getAgencyIdForOrganization(organizationId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('organizations')
      .select('agency_id')
      .eq('id', organizationId)
      .maybeSingle();
    if (error) {
      console.error('getAgencyIdForOrganization error:', error);
      return null;
    }
    return (data as { agency_id: string | null } | null)?.agency_id ?? null;
  } catch (e) {
    console.error('getAgencyIdForOrganization exception:', e);
    return null;
  }
}

/**
 * Update the display name of an organization.
 * Only the owner / members with org-level write access can do this (enforced by RLS).
 */
export async function updateOrganizationName(
  organizationId: string,
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: uiCopy.org.nameEmpty };
    const { error } = await supabase
      .from('organizations')
      .update({ name: trimmed })
      .eq('id', organizationId);
    if (error) {
      console.error('updateOrganizationName error:', error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    console.error('updateOrganizationName exception:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

/**
 * Transfers org ownership to an existing member of the organization.
 * Only the current owner can call this.
 * Required before the former owner can delete their account (ON DELETE RESTRICT).
 */
export async function transferOrgOwnership(
  organizationId: string,
  newOwnerUserId: string,
): Promise<ServiceResult> {
  try {
    const { data, error } = await supabase.rpc('transfer_org_ownership', {
      p_organization_id: organizationId,
      p_new_owner_id: newOwnerUserId,
    });
    if (error) {
      console.error('transferOrgOwnership error:', error);
      return serviceErr(error.message ?? 'rpc_error');
    }
    const j = data as { ok?: boolean; error?: string };
    if (!j?.ok) return serviceErr(j?.error ?? 'transfer_failed');
    return serviceOk();
  } catch (e) {
    console.error('transferOrgOwnership exception:', e);
    return serviceErr(e instanceof Error ? e.message : 'unknown');
  }
}

/**
 * Soft-dissolves the organization (Two-Stage Model, Migration A):
 *   • Marks `dissolved_at` and `scheduled_purge_at` (= now() + 30 days)
 *   • Removes all members + invitations immediately
 *   • Notifies former members via in-app notification (organization_dissolved)
 *   • Locally marks the Stripe subscription as canceled
 *
 * After this call returns OK, the caller (frontend) should invoke
 * `cancelDissolvedOrgStripeSubscription(organization_id)` to actually cancel
 * the live Stripe subscription. That step is fail-tolerant — a Stripe error
 * does NOT undo the dissolve.
 *
 * Hard-purge of all referencing B2B data happens 30 days later via the daily
 * cron job (`run_scheduled_purge_dissolved_organizations`, Migrations B+C).
 *
 * Only the current owner can call this. After dissolving, the owner can
 * delete their own account without FK violations.
 */
export interface DissolveOrganizationResult {
  organizationId: string;
  organizationName?: string;
  dissolvedAt?: string;
  scheduledPurgeAt?: string;
  notifiedMembers?: number;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}

export async function dissolveOrganization(
  organizationId: string,
): Promise<ServiceResult<DissolveOrganizationResult>> {
  try {
    const { data, error } = await supabase.rpc('dissolve_organization', {
      p_organization_id: organizationId,
    });
    if (error) {
      console.error('dissolveOrganization error:', error);
      return serviceErr(error.message ?? 'rpc_error');
    }
    const j = data as {
      ok?: boolean;
      error?: string;
      organization_id?: string;
      organization_name?: string;
      dissolved_at?: string;
      scheduled_purge_at?: string;
      notified_members?: number;
      stripe_customer_id?: string | null;
      stripe_subscription_id?: string | null;
    };
    if (!j?.ok) return serviceErr(j?.error ?? 'dissolve_failed');
    return {
      ok: true,
      data: {
        organizationId: j.organization_id ?? organizationId,
        organizationName: j.organization_name,
        dissolvedAt: j.dissolved_at,
        scheduledPurgeAt: j.scheduled_purge_at,
        notifiedMembers: j.notified_members,
        stripeCustomerId: j.stripe_customer_id ?? null,
        stripeSubscriptionId: j.stripe_subscription_id ?? null,
      },
    };
  } catch (e) {
    console.error('dissolveOrganization exception:', e);
    return serviceErr(e instanceof Error ? e.message : 'unknown');
  }
}

/**
 * Calls the `stripe-cancel-dissolved-org` Edge Function to cancel the live
 * Stripe subscription of an organization that was just soft-dissolved.
 *
 * Fail-tolerant: a Stripe error returns `ok: false` but the local soft-dissolve
 * state (notifications, member removal, scheduled_purge_at, local
 * `organization_subscriptions.status = 'canceled'`) remains intact. Ops can
 * reconcile via Stripe dashboard or by re-invoking this function.
 *
 * Should be called by the frontend immediately after `dissolveOrganization`
 * returns OK.
 */
export async function cancelDissolvedOrgStripeSubscription(
  organizationId: string,
): Promise<ServiceResult<{ stripeSubscriptionId?: string; stripeStatus?: string; note?: string }>> {
  try {
    const { data, error } = await supabase.functions.invoke('stripe-cancel-dissolved-org', {
      body: { organization_id: organizationId },
    });
    if (error) {
      console.warn('cancelDissolvedOrgStripeSubscription invoke error:', error);
      return serviceErr(error.message ?? 'invoke_error');
    }
    const j = data as {
      ok?: boolean;
      error?: string;
      message?: string;
      note?: string;
      stripe_subscription_id?: string;
      stripe_status?: string;
    };
    if (!j?.ok) {
      return serviceErr(j?.error ?? j?.message ?? 'stripe_cancel_failed');
    }
    return {
      ok: true,
      data: {
        stripeSubscriptionId: j.stripe_subscription_id,
        stripeStatus: j.stripe_status,
        note: j.note,
      },
    };
  } catch (e) {
    console.warn('cancelDissolvedOrgStripeSubscription exception:', e);
    return serviceErr(e instanceof Error ? e.message : 'unknown');
  }
}

/** Fetch a single organization row by id (reads name, type, owner_id). */
export async function getOrganizationById(organizationId: string): Promise<OrganizationRow | null> {
  try {
    const { data, error } = await supabase
      .from('organizations')
      .select('id, name, type, owner_id, agency_id, created_at')
      .eq('id', organizationId)
      .maybeSingle();
    if (error) {
      console.error('getOrganizationById error:', error);
      return null;
    }
    return (data as OrganizationRow) ?? null;
  } catch (e) {
    console.error('getOrganizationById exception:', e);
    return null;
  }
}

/**
 * Revokes (hard-deletes) a pending invitation.
 * Only the org owner can call this — enforced by the invitations_delete_owner_only RLS policy.
 */
export async function revokeOrganizationInvitation(
  invitationId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('invitations')
      .delete()
      .eq('id', invitationId)
      .eq('status', 'pending');
    if (error) {
      console.error('revokeOrganizationInvitation error:', error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    console.error('revokeOrganizationInvitation exception:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

/**
 * Removes a member from an organization and force-revokes all their active
 * sessions via the `member-remove` Edge Function.
 *
 * EXPLOIT-H1 fix: a plain DELETE on organization_members leaves the removed
 * member's JWT valid for up to 60 minutes. The Edge Function calls
 * auth.admin.signOut(userId, 'global') immediately after deleting the row,
 * cutting off Realtime subscriptions and new API requests instantly.
 *
 * Only organization owners are allowed to call this.
 */
export async function removeOrganizationMember(
  targetUserId: string,
  organizationId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('member-remove', {
      body: { targetUserId, organizationId },
    });
    if (error) {
      console.error('removeOrganizationMember invoke error:', error);
      return { ok: false, error: error.message ?? 'unknown' };
    }
    const result = data as { ok: boolean; error?: string } | null;
    if (!result?.ok) {
      console.error('removeOrganizationMember function error:', result?.error);
      return { ok: false, error: result?.error ?? 'Failed to remove member' };
    }
    return { ok: true };
  } catch (e) {
    console.error('removeOrganizationMember exception:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

/** First client-type organization for a user (B2B org context). */
export async function getClientOrganizationIdForUser(clientUserId: string): Promise<string | null> {
  try {
    const { data: mems, error: e1 } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', clientUserId);
    if (e1) {
      console.error('getClientOrganizationIdForUser members error:', e1);
      return null;
    }
    const orgIds = [
      ...new Set((mems ?? []).map((m: { organization_id: string }) => m.organization_id)),
    ];
    if (orgIds.length === 0) return null;
    const { data: orgs, error: e2 } = await supabase
      .from('organizations')
      .select('id')
      .in('id', orgIds)
      .eq('type', 'client')
      .limit(1);
    if (e2) {
      console.error('getClientOrganizationIdForUser orgs error:', e2);
      return null;
    }
    return (orgs?.[0] as { id: string } | undefined)?.id ?? null;
  } catch (e) {
    console.error('getClientOrganizationIdForUser exception:', e);
    return null;
  }
}
