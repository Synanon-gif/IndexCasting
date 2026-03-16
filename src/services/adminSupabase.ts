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
  let query = supabase
    .from('profiles')
    .select('id, email, display_name, role, is_active, is_admin, tos_accepted, privacy_accepted, agency_model_rights_accepted, activation_documents_sent, verification_email, company_name, phone, country, created_at, deactivated_at, deactivated_reason')
    .order('created_at', { ascending: false });

  if (filter?.activeOnly) query = query.eq('is_active', true);
  if (filter?.inactiveOnly) query = query.eq('is_active', false);
  if (filter?.role) query = query.eq('role', filter.role);

  const { data, error } = await query;
  if (error) { console.error('getAllProfiles error:', error); return []; }
  return (data ?? []) as AdminProfile[];
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
    is_admin?: boolean;
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
    p_is_admin: fields.is_admin ?? null,
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
