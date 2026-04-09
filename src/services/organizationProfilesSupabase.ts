import { supabase } from '../../lib/supabase';
import { assertOrgContext } from '../utils/orgGuard';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrganizationProfile {
  organization_id: string;
  logo_url: string | null;
  description: string | null;
  address_line_1: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  website_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  slug: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrganizationProfilePayload {
  logo_url?: string | null;
  description?: string | null;
  address_line_1?: string | null;
  city?: string | null;
  postal_code?: string | null;
  country?: string | null;
  website_url?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  slug?: string | null;
  is_public?: boolean;
}

export interface OrganizationProfileMedia {
  id: string;
  organization_id: string;
  media_type: 'client_gallery' | 'agency_model_cover';
  model_id: string | null;
  title: string | null;
  image_url: string;
  gender_group: 'female' | 'male' | null;
  sort_order: number;
  is_visible_public: boolean;
  created_at: string;
}

export interface OrganizationProfileMediaPayload {
  media_type: 'client_gallery' | 'agency_model_cover';
  image_url: string;
  model_id?: string | null;
  title?: string | null;
  gender_group?: 'female' | 'male' | null;
  sort_order?: number;
  is_visible_public?: boolean;
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Fetch the organization profile for a given org.
 * Returns null when no profile row exists yet or on error.
 * RLS enforces that only org members and linked models (for agency orgs)
 * can read the profile.
 */
export async function getOrganizationProfile(
  organizationId: string,
): Promise<OrganizationProfile | null> {
  if (!organizationId) {
    console.error('[getOrganizationProfile] organizationId is empty — call aborted');
    return null;
  }
  try {
    const { data, error } = await supabase
      .from('organization_profiles')
      .select('*')
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error) {
      console.error('[getOrganizationProfile] error:', error);
      return null;
    }
    return (data as OrganizationProfile) ?? null;
  } catch (e) {
    console.error('[getOrganizationProfile] exception:', e);
    return null;
  }
}

/**
 * Create or update the organization profile for a given org.
 * Only the org owner can write (enforced by RLS on the DB side).
 * Returns true on success, false on error.
 */
export async function upsertOrganizationProfile(
  organizationId: string,
  payload: Partial<OrganizationProfilePayload>,
): Promise<boolean> {
  if (!assertOrgContext(organizationId, 'upsertOrganizationProfile')) return false;
  try {
    const { error } = await supabase
      .from('organization_profiles')
      .upsert(
        { ...payload, organization_id: organizationId, updated_at: new Date().toISOString() },
        { onConflict: 'organization_id' },
      );
    if (error) {
      console.error('[upsertOrganizationProfile] error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[upsertOrganizationProfile] exception:', e);
    return false;
  }
}

/**
 * List all media rows for a given org profile.
 * Returns [] on error or when no rows exist.
 * RLS enforces that only org members and linked models (agency orgs) can read.
 */
export async function listOrganizationProfileMedia(
  organizationId: string,
): Promise<OrganizationProfileMedia[]> {
  if (!organizationId) {
    console.error('[listOrganizationProfileMedia] organizationId is empty — call aborted');
    return [];
  }
  try {
    const { data, error } = await supabase
      .from('organization_profile_media')
      .select('*')
      .eq('organization_id', organizationId)
      .order('sort_order', { ascending: true });
    if (error) {
      console.error('[listOrganizationProfileMedia] error:', error);
      return [];
    }
    return (data ?? []) as OrganizationProfileMedia[];
  } catch (e) {
    console.error('[listOrganizationProfileMedia] exception:', e);
    return [];
  }
}

/**
 * Add a new media row to an org profile.
 * Only the org owner can insert (enforced by RLS on the DB side).
 * Returns the created row on success, null on error.
 */
export async function createOrganizationProfileMedia(
  organizationId: string,
  payload: OrganizationProfileMediaPayload,
): Promise<OrganizationProfileMedia | null> {
  if (!assertOrgContext(organizationId, 'createOrganizationProfileMedia')) return null;
  try {
    const { data, error } = await supabase
      .from('organization_profile_media')
      .insert({ ...payload, organization_id: organizationId })
      .select('*')
      .single();
    if (error) {
      console.error('[createOrganizationProfileMedia] error:', error);
      return null;
    }
    return (data as OrganizationProfileMedia) ?? null;
  } catch (e) {
    console.error('[createOrganizationProfileMedia] exception:', e);
    return null;
  }
}

/**
 * Delete a media row by its id.
 * Only the org owner can delete (enforced by RLS: is_org_owner(organization_id)).
 * Returns true on success, false on error.
 */
export async function deleteOrganizationProfileMedia(mediaId: string): Promise<boolean> {
  if (!mediaId) {
    console.error('[deleteOrganizationProfileMedia] mediaId is empty — call aborted');
    return false;
  }
  try {
    const { error } = await supabase
      .from('organization_profile_media')
      .delete()
      .eq('id', mediaId);
    if (error) {
      console.error('[deleteOrganizationProfileMedia] error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[deleteOrganizationProfileMedia] exception:', e);
    return false;
  }
}
