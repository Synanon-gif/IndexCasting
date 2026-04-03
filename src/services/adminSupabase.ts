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
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();
    return data?.is_admin === true;
  } catch (e) {
    console.error('isCurrentUserAdmin exception:', e);
    return false;
  }
}

/** Returns true only for the platform Super-Admin (is_super_admin = true).
 *  Super-Admin is the sole identity allowed to read admin_logs. */
export async function isCurrentUserSuperAdmin(): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .maybeSingle();
    return data?.is_super_admin === true;
  } catch (e) {
    console.error('isCurrentUserSuperAdmin exception:', e);
    return false;
  }
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
    if (!error) return (data ?? []) as AdminProfile[];

    // RPC failed — fall back to a direct table query only when the caller is a
    // confirmed admin. Without this guard, any authenticated user could trigger
    // the fallback and enumerate all profile IDs and roles.
    console.warn('[Admin] admin_get_profiles RPC failed, checking admin status before fallback:', error.message);
    const isAdmin = await isCurrentUserAdmin();
    if (!isAdmin) {
      console.error('[Admin] getAllProfiles: non-admin fallback attempt blocked.');
      return [];
    }
    return await _getAllProfilesDirect(filter);
  } catch (e) {
    console.error('[Admin] getAllProfiles exception:', e);
    try {
      const isAdmin = await isCurrentUserAdmin();
      if (!isAdmin) return [];
      return await _getAllProfilesDirect(filter);
    } catch {
      return [];
    }
  }
}

async function _getAllProfilesDirect(filter?: {
  activeOnly?: boolean;
  inactiveOnly?: boolean;
  role?: string;
}): Promise<AdminProfile[]> {
  try {
    let q = supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (filter?.activeOnly)   q = q.eq('is_active', true);
    if (filter?.inactiveOnly) q = q.eq('is_active', false);
    if (filter?.role)         q = q.eq('role', filter.role);
    const { data, error } = await q;
    if (error) { console.error('[Admin] _getAllProfilesDirect error:', error); return []; }
    return (data ?? []) as AdminProfile[];
  } catch (e) {
    console.error('[Admin] _getAllProfilesDirect exception:', e);
    return [];
  }
}

export async function activateAccount(userId: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('admin_set_account_active', {
      target_id: userId,
      active: true,
    });
    if (error) { console.error('activateAccount error:', error); return false; }
    return true;
  } catch (e) {
    console.error('activateAccount exception:', e);
    return false;
  }
}

export async function deactivateAccount(userId: string, reason?: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('admin_set_account_active', {
      target_id: userId,
      active: false,
      reason: reason || null,
    });
    if (error) { console.error('deactivateAccount error:', error); return false; }
    return true;
  } catch (e) {
    console.error('deactivateAccount exception:', e);
    return false;
  }
}

export async function adminUpdateProfileField(
  userId: string,
  fieldName: string,
  fieldValue: string
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('admin_update_profile', {
      target_id: userId,
      field_name: fieldName,
      field_value: fieldValue,
    });
    if (error) { console.error('adminUpdateProfileField error:', error); return false; }
    return true;
  } catch (e) {
    console.error('adminUpdateProfileField exception:', e);
    return false;
  }
}

/** Admin: Purge all public data for a user (profile + CASCADE). Call auth.admin.deleteUser(id) via Edge Function/Dashboard to complete. */
export async function adminPurgeUserData(
  targetUserId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { error } = await supabase.rpc('admin_purge_user_data', { target_id: targetUserId });
    if (error) {
      console.error('adminPurgeUserData error:', error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    console.error('adminPurgeUserData exception:', e);
    return { ok: false, error: 'Failed to purge user data' };
  }
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
  try {
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
  } catch (e) {
    console.error('adminUpdateProfileFull exception:', e);
    return false;
  }
}

export async function getAdminLogs(limit = 100, offset = 0): Promise<AdminLogEntry[]> {
  // Only Super-Admin can read audit logs — regular admins are blocked by RLS.
  // Client-side guard mirrors the DB policy (super_admin_logs_select).
  const callerIsSuperAdmin = await isCurrentUserSuperAdmin();
  if (!callerIsSuperAdmin) {
    console.error('[Admin] getAdminLogs: requires is_super_admin — access blocked.');
    return [];
  }
  try {
    const { data, error } = await supabase
      .from('admin_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) { console.error('getAdminLogs error:', error); return []; }
    return (data ?? []) as AdminLogEntry[];
  } catch (e) {
    console.error('getAdminLogs exception:', e);
    return [];
  }
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
    if (!error) {
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      return (rows as Array<Record<string, unknown>>)
        .filter((r) => r?.organization_id)
        .map((r) => ({
          organization_id: String(r.organization_id),
          org_name: String(r.org_name ?? ''),
          org_type: (r.org_type === 'client' ? 'client' : 'agency') as 'agency' | 'client',
          member_role: r.member_role as AdminOrgMembership['member_role'],
        }));
    }
    // Fallback: direct join query — admin check required before proceeding.
    console.warn('[Admin] admin_list_org_memberships RPC failed, checking admin status:', error.message);
    const isAdminFallback = await isCurrentUserAdmin();
    if (!isAdminFallback) {
      console.error('[Admin] adminListOrgMemberships: non-admin fallback attempt blocked.');
      return [];
    }
    const { data: direct, error: dErr } = await supabase
      .from('organization_members')
      .select('organization_id, role, organizations(id, name, type)')
      .eq('user_id', targetUserId);
    if (dErr) { console.error('[Admin] direct org memberships error:', dErr); return []; }
    return ((direct ?? []) as Array<Record<string, unknown>>)
      .filter((r) => r?.organization_id)
      .map((r) => {
        const org = r.organizations as Record<string, unknown> | null;
        return {
          organization_id: String(r.organization_id),
          org_name: String(org?.name ?? ''),
          org_type: (org?.type === 'client' ? 'client' : 'agency') as 'agency' | 'client',
          member_role: (r.role ?? 'employee') as AdminOrgMembership['member_role'],
        };
      });
  } catch (e) {
    console.error('[Admin] adminListOrgMemberships exception:', e);
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
  // Any admin can insert log entries — they cannot READ the log (is_super_admin
  // required for SELECT), so they cannot learn what is logged or craft entries
  // to obscure specific existing records.
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('admin_logs').insert({
      admin_id: user.id,
      action,
      target_user_id: targetUserId || null,
      details: details || {},
    });
    if (error) {
      console.error('writeAdminLog: failed to persist audit entry', { action, targetUserId, error });
    }
  } catch (e) {
    console.error('writeAdminLog exception — audit trail entry lost:', { action, targetUserId, e });
  }
}

// ─── Organization admin types & functions ────────────────────────────────────

export type AdminOrganization = {
  id: string;
  name: string;
  type: 'agency' | 'client';
  owner_id: string;
  /** true/false = migration applied and column set; null = column not yet in DB (pre-migration fallback) */
  is_active: boolean | null;
  admin_notes: string | null;
  member_count: number;
  created_at: string;
};

/**
 * Returns all organizations + whether the full admin migration is applied.
 * Falls back to reconstructing orgs from existing profile+membership RPCs
 * when migration_admin_org_model_control.sql has not yet been run.
 */
export async function adminListOrganizations(): Promise<{ data: AdminOrganization[]; migrationApplied: boolean }> {
  try {
    const { data, error } = await supabase.rpc('admin_list_organizations');
    if (!error) {
      return {
        migrationApplied: true,
        data: ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
          // Patch migration uses 'org_type'; original used 'type' — handle both
          const rawType = r.org_type ?? r.type;
          return {
            id: String(r.id),
            name: String(r.name ?? ''),
            type: (rawType === 'client' ? 'client' : 'agency') as 'agency' | 'client',
            owner_id: String(r.owner_id ?? ''),
            is_active: r.is_active === true,
            admin_notes: r.admin_notes != null ? String(r.admin_notes) : null,
            member_count: Number(r.member_count ?? 0),
            created_at: String(r.created_at ?? ''),
          };
        }),
      };
    }
    // Migration not applied yet — fall back to reconstructing from existing RPCs.
    console.warn('admin_list_organizations RPC unavailable:', error?.message, '— using fallback');
    const fallback = await _adminListOrgsFallback().catch(() => [] as AdminOrganization[]);
    return { migrationApplied: false, data: fallback };
  } catch (e) {
    console.error('adminListOrganizations exception:', e);
    const fallback = await _adminListOrgsFallback().catch(() => [] as AdminOrganization[]);
    return { migrationApplied: false, data: fallback };
  }
}

/** Fallback: load orgs directly from table.
 *  Works for admins once the "admin_select_all_organizations" RLS policy is applied
 *  (migration_admin_org_rls_and_full_backfill.sql). Without that policy this query
 *  is limited by member-based RLS and returns only the admin's own org.
 */
async function _adminListOrgsFallback(): Promise<AdminOrganization[]> {
  try {
    const { data, error } = await supabase
      .from('organizations')
      .select('id, name, type, owner_id, created_at, organization_members(user_id, role)')
      .order('name');

    if (error) {
      console.error('[Admin] _adminListOrgsFallback direct query error:', error.message);
    }

    if (!error && data && (data as unknown[]).length > 0) {
      return (data as Array<Record<string, unknown>>).map((o) => {
        const members = (o.organization_members as Array<Record<string, unknown>> | null) ?? [];
        return {
          id: String(o.id),
          name: String(o.name ?? ''),
          type: (o.type === 'client' ? 'client' : 'agency') as 'agency' | 'client',
          owner_id: String(o.owner_id ?? ''),
          is_active: null,
          admin_notes: null,
          member_count: members.length,
          created_at: String(o.created_at ?? ''),
        };
      });
    }

    // Last resort: reconstruct from per-profile membership RPCs.
    // This is slow (N+1) but works even without the admin SELECT RLS policy.
    console.warn('[Admin] direct orgs query empty, using membership RPC fallback');
    const profiles = await getAllProfiles();
    const b2bProfiles = profiles.filter((p) => p.role === 'agent' || p.role === 'client');
    if (b2bProfiles.length === 0) return [];

    const orgMap = new Map<string, AdminOrganization>();
    await Promise.all(
      b2bProfiles.map(async (profile) => {
        try {
          const memberships = await adminListOrgMemberships(profile.id);
          for (const m of memberships) {
            if (!orgMap.has(m.organization_id)) {
              orgMap.set(m.organization_id, {
                id: m.organization_id,
                name: m.org_name,
                type: m.org_type,
                owner_id: m.member_role === 'owner' ? profile.id : '',
                is_active: null,
                admin_notes: null,
                member_count: 1,
                created_at: profile.created_at ?? '',
              });
            } else {
              const existing = orgMap.get(m.organization_id)!;
              existing.member_count++;
              if (m.member_role === 'owner') existing.owner_id = profile.id;
            }
          }
        } catch { /* ignore per-profile errors */ }
      })
    );
    return Array.from(orgMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    console.error('[Admin] _adminListOrgsFallback exception:', e);
    return [];
  }
}

export async function adminSetOrgActive(orgId: string, active: boolean): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('admin_set_org_active', {
      p_org_id: orgId,
      p_active: active,
    });
    if (error) { console.error('adminSetOrgActive error:', error); return false; }
    return true;
  } catch (e) {
    console.error('adminSetOrgActive exception:', e);
    return false;
  }
}

export async function adminUpdateOrgDetails(
  orgId: string,
  fields: {
    name?: string | null;
    newOwnerId?: string | null;
    adminNotes?: string | null;
    clearNotes?: boolean;
  }
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('admin_update_org_details', {
      p_org_id:       orgId,
      p_name:         fields.name         ?? null,
      p_new_owner_id: fields.newOwnerId   ?? null,
      p_admin_notes:  fields.adminNotes   ?? null,
      p_clear_notes:  fields.clearNotes   ?? false,
    });
    if (error) { console.error('adminUpdateOrgDetails error:', error); return false; }
    return true;
  } catch (e) {
    console.error('adminUpdateOrgDetails exception:', e);
    return false;
  }
}

// ─── Model admin types & functions ───────────────────────────────────────────

export type AdminModel = {
  id: string;
  name: string;
  email: string | null;
  agency_id: string | null;
  user_id: string | null;
  /** true/false = migration applied; null = pre-migration fallback (column not yet in DB) */
  is_active: boolean | null;
  admin_notes: string | null;
  created_at: string;
};

/**
 * Returns all models + whether the full admin migration is applied.
 * Falls back to a direct Supabase query when the RPC doesn't exist yet.
 * Models have a broad SELECT RLS policy (needed for discovery), so
 * the direct query works for the admin without additional migration.
 */
export async function adminListAllModels(): Promise<{ data: AdminModel[]; migrationApplied: boolean }> {
  try {
    const { data, error } = await supabase.rpc('admin_list_all_models');
    if (!error) {
      return {
        migrationApplied: true,
        data: ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
          id: String(r.id),
          name: String(r.name ?? ''),
          email: r.email != null ? String(r.email) : null,
          agency_id: r.agency_id != null ? String(r.agency_id) : null,
          user_id: r.user_id != null ? String(r.user_id) : null,
          is_active: r.is_active === true,
          admin_notes: r.admin_notes != null ? String(r.admin_notes) : null,
          created_at: String(r.created_at ?? ''),
        })),
      };
    }
    // Migration not applied yet — fall back to a direct query.
    console.warn('admin_list_all_models RPC unavailable:', error?.message, '— using fallback');
    const fallback = await _adminListModelsFallback().catch(() => [] as AdminModel[]);
    return { migrationApplied: false, data: fallback };
  } catch (e) {
    console.error('adminListAllModels exception:', e);
    const fallback = await _adminListModelsFallback().catch(() => [] as AdminModel[]);
    return { migrationApplied: false, data: fallback };
  }
}

async function _adminListModelsFallback(): Promise<AdminModel[]> {
  try {
    const { data, error } = await supabase
      .from('models')
      .select('id, name, email, agency_id, user_id, created_at')
      .order('name');
    if (error) { console.error('_adminListModelsFallback error:', error); return []; }
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ''),
      email: r.email != null ? String(r.email) : null,
      agency_id: r.agency_id != null ? String(r.agency_id) : null,
      user_id: r.user_id != null ? String(r.user_id) : null,
      is_active: null,
      admin_notes: null,
      created_at: String(r.created_at ?? ''),
    }));
  } catch (e) {
    console.error('_adminListModelsFallback exception:', e);
    return [];
  }
}

export async function adminSetModelActive(modelId: string, active: boolean): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('admin_set_model_active', {
      p_model_id: modelId,
      p_active:   active,
    });
    if (error) { console.error('adminSetModelActive error:', error); return false; }
    return true;
  } catch (e) {
    console.error('adminSetModelActive exception:', e);
    return false;
  }
}

export async function adminUpdateModelNotes(modelId: string, notes: string | null): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('admin_update_model_notes', {
      p_model_id:    modelId,
      p_admin_notes: notes,
    });
    if (error) { console.error('adminUpdateModelNotes error:', error); return false; }
    return true;
  } catch (e) {
    console.error('adminUpdateModelNotes exception:', e);
    return false;
  }
}

// ─── Agency Swipe Limits (Monetization) ──────────────────────────────────────

export interface AdminAgencyUsageLimits {
  organization_id: string;
  daily_swipe_limit: number;
  swipes_used_today: number;
  last_reset_date: string;
  updated_at: string;
}

/**
 * Fetches the current swipe-limit row for a given agency organisation.
 * Uses the admin RLS policy so it works even before the usage row is created.
 */
export async function adminGetAgencyUsageLimits(
  organizationId: string,
): Promise<AdminAgencyUsageLimits | null> {
  try {
    const { data, error } = await supabase
      .from('agency_usage_limits')
      .select('organization_id, daily_swipe_limit, swipes_used_today, last_reset_date, updated_at')
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error) throw error;
    return data as AdminAgencyUsageLimits | null;
  } catch (e) {
    console.error('adminGetAgencyUsageLimits error:', e);
    return null;
  }
}

/**
 * Sets the daily swipe limit for an organisation. The RPC handles upsert
 * so calling this before any swipe has occurred is safe.
 */
export async function adminSetAgencySwipeLimit(
  organizationId: string,
  limit: number,
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('admin_set_agency_swipe_limit', {
      p_organization_id: organizationId,
      p_limit:           limit,
    });
    if (error) throw error;
    await writeAdminLog(`Set daily swipe limit to ${limit} for org ${organizationId}`);
    return true;
  } catch (e) {
    console.error('adminSetAgencySwipeLimit error:', e);
    return false;
  }
}

/**
 * Resets swipes_used_today to 0 for an organisation, effective immediately
 * for all members.
 */
export async function adminResetAgencySwipeCount(organizationId: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('admin_reset_agency_swipe_count', {
      p_organization_id: organizationId,
    });
    if (error) throw error;
    await writeAdminLog(`Reset swipe count for org ${organizationId}`);
    return true;
  } catch (e) {
    console.error('adminResetAgencySwipeCount error:', e);
    return false;
  }
}

// ─── Agency Storage Override (Admin) ─────────────────────────────────────────

export interface AdminStorageOverride {
  organization_id: string;
  used_bytes: number;
  /** null = default 5 GB applies */
  storage_limit_bytes: number | null;
  is_unlimited: boolean;
  /** Resolved effective cap in bytes; null when is_unlimited = true */
  effective_limit_bytes: number | null;
}

/**
 * Fetches the storage snapshot for a single organization.
 * Auto-creates the usage row if it doesn't exist yet.
 */
export async function adminGetOrgStorageUsage(
  organizationId: string,
): Promise<AdminStorageOverride | null> {
  try {
    const { data, error } = await supabase.rpc('admin_get_org_storage_usage', {
      p_org_id: organizationId,
    });
    if (error) throw error;
    if (!data || (data as { error?: string }).error) return null;
    const raw = data as Record<string, unknown>;
    return {
      organization_id:       String(raw.organization_id),
      used_bytes:            Number(raw.used_bytes ?? 0),
      storage_limit_bytes:   raw.storage_limit_bytes != null ? Number(raw.storage_limit_bytes) : null,
      is_unlimited:          Boolean(raw.is_unlimited),
      effective_limit_bytes: raw.effective_limit_bytes != null ? Number(raw.effective_limit_bytes) : null,
    };
  } catch (e) {
    console.error('adminGetOrgStorageUsage error:', e);
    return null;
  }
}

/**
 * Sets a custom storage limit (in bytes) for an organization.
 * Accepted range: 1 byte – 1 TB. Clears the unlimited flag.
 */
export async function adminSetStorageLimit(
  organizationId: string,
  limitBytes: number,
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('admin_set_storage_limit', {
      p_organization_id: organizationId,
      p_new_limit_bytes:  limitBytes,
    });
    if (error) throw error;
    await writeAdminLog(
      `Set storage limit to ${limitBytes} bytes for org ${organizationId}`,
    );
    return true;
  } catch (e) {
    console.error('adminSetStorageLimit error:', e);
    return false;
  }
}

/**
 * Grants unlimited storage to an organization (bypasses all upload limits).
 */
export async function adminSetUnlimitedStorage(organizationId: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('admin_set_unlimited_storage', {
      p_organization_id: organizationId,
    });
    if (error) throw error;
    await writeAdminLog(`Set unlimited storage for org ${organizationId}`);
    return true;
  } catch (e) {
    console.error('adminSetUnlimitedStorage error:', e);
    return false;
  }
}

/**
 * Resets an organization's storage limit back to the platform default (5 GB).
 * Clears both the custom limit and the unlimited flag.
 */
export async function adminResetToDefaultStorageLimit(organizationId: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('admin_reset_to_default_storage_limit', {
      p_organization_id: organizationId,
    });
    if (error) throw error;
    await writeAdminLog(`Reset storage limit to default for org ${organizationId}`);
    return true;
  } catch (e) {
    console.error('adminResetToDefaultStorageLimit error:', e);
    return false;
  }
}

// ─── Billing & Paywall Admin ─────────────────────────────────────────────────

export interface AdminOrgSubscription {
  organization_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string | null;
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  current_period_end: string | null;
  trial_ends_at: string;
  created_at: string;
}

export interface AdminBillingStatus {
  subscription: AdminOrgSubscription | null;
  admin_override: {
    organization_id: string;
    bypass_paywall: boolean;
    custom_plan: string | null;
  } | null;
}

/**
 * Fetches full billing status for an organization (subscription + override).
 * Uses the admin_get_org_subscription RPC — requires is_admin.
 */
export async function adminGetBillingStatus(
  organizationId: string,
): Promise<AdminBillingStatus | null> {
  try {
    const { data, error } = await supabase.rpc('admin_get_org_subscription', {
      p_org_id: organizationId,
    });
    if (error) throw error;
    const raw = data as Record<string, unknown>;
    return {
      subscription:    (raw.subscription    as AdminOrgSubscription | null) ?? null,
      admin_override:  (raw.admin_override  as AdminBillingStatus['admin_override']) ?? null,
    };
  } catch (e) {
    console.error('adminGetBillingStatus error:', e);
    return null;
  }
}

/**
 * Enables or disables the paywall bypass for an organization.
 * Optionally sets a custom plan label.
 * THE only path to set bypass_paywall — enforced server-side.
 */
export async function adminSetBypassPaywall(
  organizationId: string,
  bypass: boolean,
  customPlan?: string | null,
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('admin_set_bypass_paywall', {
      p_org_id:      organizationId,
      p_bypass:      bypass,
      p_custom_plan: customPlan ?? null,
    });
    if (error) throw error;
    await writeAdminLog(
      `${bypass ? 'Enabled' : 'Disabled'} paywall bypass for org ${organizationId}${customPlan ? ` (plan: ${customPlan})` : ''}`,
    );
    return true;
  } catch (e) {
    console.error('adminSetBypassPaywall error:', e);
    return false;
  }
}

/**
 * Manually sets the subscription plan and status for an organization.
 * Also syncs the daily swipe limit in agency_usage_limits.
 */
export async function adminSetOrgPlan(
  organizationId: string,
  plan: string,
  status: 'trialing' | 'active' | 'past_due' | 'canceled' = 'active',
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('admin_set_org_plan', {
      p_org_id: organizationId,
      p_plan:   plan,
      p_status: status,
    });
    if (error) throw error;
    await writeAdminLog(`Set plan '${plan}' (${status}) for org ${organizationId}`);
    return true;
  } catch (e) {
    console.error('adminSetOrgPlan error:', e);
    return false;
  }
}
