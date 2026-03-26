import { supabase } from '../../lib/supabase';

export type AdminProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  is_active: boolean;
  is_admin: boolean;
  tos_accepted: boolean;
  privacy_accepted: boolean;
  agency_model_rights_accepted: boolean;
  activation_documents_sent: boolean;
  verification_email: string | null;
  company_name: string | null;
  phone: string | null;
  country: string | null;
  created_at: string;
  deactivated_at: string | null;
  deactivated_reason: string | null;
};

export type AdminLogEntry = {
  id: string;
  admin_id: string;
  action: string;
  target_user_id: string | null;
  target_table: string | null;
  target_record_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

export async function isCurrentUserAdmin(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();
  return data?.is_admin === true;
}

export async function getAllProfiles(filter?: {
  activeOnly?: boolean;
  inactiveOnly?: boolean;
  role?: string;
}): Promise<AdminProfile[]> {
  try {
    const { data, error } = await supabase.rpc('admin_get_profiles', {
      p_active_only:   filter?.activeOnly   ?? null,
      p_inactive_only: filter?.inactiveOnly ?? null,
      p_role:          filter?.role         ?? null,
    });
    if (error) { console.error('getAllProfiles error:', error); return []; }
    return (data ?? []) as AdminProfile[];
  } catch (e) {
    console.error('getAllProfiles exception:', e);
    return [];
  }
}

export async function activateAccount(userId: string): Promise<boolean> {
  const { error } = await supabase.rpc('admin_set_account_active', {
    target_id: userId,
    active: true,
  });
  if (error) { console.error('activateAccount error:', error); return false; }
  return true;
}

export async function deactivateAccount(userId: string, reason?: string): Promise<boolean> {
  const { error } = await supabase.rpc('admin_set_account_active', {
    target_id: userId,
    active: false,
    reason: reason || null,
  });
  if (error) { console.error('deactivateAccount error:', error); return false; }
  return true;
}

export async function adminUpdateProfileField(
  userId: string,
  fieldName: string,
  fieldValue: string
): Promise<boolean> {
  const { error } = await supabase.rpc('admin_update_profile', {
    target_id: userId,
    field_name: fieldName,
    field_value: fieldValue,
  });
  if (error) { console.error('adminUpdateProfileField error:', error); return false; }
  return true;
}

/** Admin: Vollständiges Profil-Update (umgeht RLS, speichert zuverlässig). */
export async function adminUpdateProfileFull(
  targetId: string,
  fields: {
    display_name?: string | null;
    email?: string | null;
    company_name?: string | null;
    phone?: string | null;
    website?: string | null;
    country?: string | null;
    role?: string | null;
    is_active?: boolean;
  }
): Promise<boolean> {
  const { error } = await supabase.rpc('admin_update_profile_full', {
    target_id: targetId,
    p_display_name: fields.display_name ?? null,
    p_email: fields.email ?? null,
    p_company_name: fields.company_name ?? null,
    p_phone: fields.phone ?? null,
    p_website: fields.website ?? null,
    p_country: fields.country ?? null,
    p_role: fields.role ?? null,
    p_is_active: fields.is_active ?? null,
    p_is_admin: null,
  });
  if (error) {
    console.error('adminUpdateProfileFull error:', error);
    return false;
  }
  return true;
}

export async function getAdminLogs(limit = 100, offset = 0): Promise<AdminLogEntry[]> {
  const { data, error } = await supabase
    .from('admin_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) { console.error('getAdminLogs error:', error); return []; }
  return (data ?? []) as AdminLogEntry[];
}

/** Admin: Purge all public data for a user (profile + CASCADE). Call auth.admin.deleteUser(id) via Edge Function/Dashboard to complete. */
export async function adminPurgeUserData(
  targetUserId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc('admin_purge_user_data', { target_id: targetUserId });
  if (error) {
    console.error('adminPurgeUserData error:', error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export type AdminOrgMembership = {
  organization_id: string;
  org_name: string;
  org_type: 'agency' | 'client';
  member_role: 'owner' | 'booker' | 'employee';
};

/** Admin: B2B rows in organization_members (Owner vs Booker/Employee). Requires migration_admin_organization_member_role.sql */
export async function adminListOrgMemberships(targetUserId: string): Promise<AdminOrgMembership[]> {
  try {
    const { data, error } = await supabase.rpc('admin_list_org_memberships', {
      p_target_user_id: targetUserId,
    });
    if (error) {
      console.error('adminListOrgMemberships error:', error);
      return [];
    }
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    return (rows as Array<Record<string, unknown>>)
      .filter((r) => r?.organization_id)
      .map((r) => ({
        organization_id: String(r.organization_id),
        org_name: String(r.org_name ?? ''),
        org_type: (r.org_type === 'client' ? 'client' : 'agency') as 'agency' | 'client',
        member_role: r.member_role as AdminOrgMembership['member_role'],
      }));
  } catch (e) {
    console.error('adminListOrgMemberships exception:', e);
    return [];
  }
}

export async function adminSetOrganizationMemberRole(
  targetUserId: string,
  organizationId: string,
  role: 'owner' | 'booker' | 'employee'
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { error } = await supabase.rpc('admin_set_organization_member_role', {
      p_target_user_id: targetUserId,
      p_organization_id: organizationId,
      p_role: role,
    });
    if (error) {
      console.error('adminSetOrganizationMemberRole error:', error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.error('adminSetOrganizationMemberRole exception:', e);
    return { ok: false, error: msg };
  }
}

export async function writeAdminLog(action: string, targetUserId?: string, details?: Record<string, unknown>): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('admin_logs').insert({
    admin_id: user.id,
    action,
    target_user_id: targetUserId || null,
    details: details || {},
  });
}
