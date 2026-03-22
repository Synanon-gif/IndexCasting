import { Platform } from 'react-native';
import { supabase } from '../../lib/supabase';
import { buildInviteAbsoluteUrl, buildInviteDeepLinkPath } from './inviteUrlHelpers';

export type OrganizationType = 'agency' | 'client';
export type OrgMemberRole = 'owner' | 'booker' | 'employee';
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

export type InvitationPreview = {
  org_name: string;
  org_type: OrganizationType;
  invite_role: InvitationRole;
  expires_at: string;
};

function randomInviteToken(): string {
  const u = () =>
    'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  return `${u()}${u()}`.replace(/-/g, '');
}

export function buildOrganizationInviteUrl(token: string): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return buildInviteAbsoluteUrl(
      window.location.origin,
      window.location.pathname || '/',
      token
    );
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

export async function listOrganizationMembers(organizationId: string): Promise<
  Array<OrganizationMemberRow & { display_name: string | null; email: string | null }>
> {
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
    const ids = rows.map((r) => r.user_id);
    const { data: profiles, error: pErr } = await supabase
      .from('profiles')
      .select('id, display_name, email')
      .in('id', ids);
    if (pErr) console.error('listOrganizationMembers profiles error:', pErr);
    const map = new Map((profiles ?? []).map((p: { id: string; display_name: string | null; email: string | null }) => [p.id, p]));
    return rows.map((m) => ({
      ...m,
      display_name: map.get(m.user_id)?.display_name ?? null,
      email: map.get(m.user_id)?.email ?? null,
    }));
  } catch (e) {
    console.error('listOrganizationMembers exception:', e);
    return [];
  }
}

export async function listInvitationsForOrganization(organizationId: string): Promise<InvitationRow[]> {
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
}): Promise<InvitationRow | null> {
  try {
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      console.error('createOrganizationInvitation: no user', userErr);
      return null;
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
      return null;
    }
    return data as InvitationRow;
  } catch (e) {
    console.error('createOrganizationInvitation exception:', e);
    return null;
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
  agencyId: string
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
    const orgIds = [...new Set((mems ?? []).map((m: { organization_id: string }) => m.organization_id))];
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
