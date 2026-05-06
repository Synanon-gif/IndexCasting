/**
 * Public Agency Profile Service — Phase 3A.1 (+ post-deploy RPC hardening)
 *
 * Provides public-safe data access for agency profiles.
 * No authentication required; both functions call SECURITY DEFINER RPCs
 * that enforce is_public=true + type='agency' guards server-side.
 *
 * Allowlisted fields only — no PII, no org-member data, no internal fields.
 * These functions deliberately do NOT use assertOrgContext (public access).
 */

import { supabase } from '../../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Public-safe subset of organization_profiles + organizations.
 * Only fields on the explicit allowlist — no contact_email, contact_phone,
 * slug, or any internal/operational data.
 */
export interface PublicAgencyProfile {
  organization_id: string;
  agency_id: string;
  name: string;
  logo_url: string | null;
  description: string | null;
  address_line_1: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  website_url: string | null;
}

/**
 * Minimal public model record.
 * Only id, name, sex, and first portfolio image exposed.
 */
export interface PublicAgencyModel {
  id: string;
  name: string;
  sex: string | null;
  cover_url: string | null;
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Fetches a public agency profile by slug.
 *
 * Returns null when:
 *   - slug is empty or whitespace-only (no RPC call)
 *   - slug not found
 *   - profile exists but is_public = false
 *   - organization type ≠ 'agency'
 *
 * Safe for unauthenticated callers (anon Supabase key).
 */
export async function getPublicAgencyProfile(slug: string): Promise<PublicAgencyProfile | null> {
  if (!slug) return null;
  if (!slug.trim()) return null;

  try {
    const { data, error } = await supabase.rpc('get_public_agency_profile', {
      p_slug: slug,
    });

    if (error) {
      console.error('[getPublicAgencyProfile] RPC error:', error);
      return null;
    }

    // RPC returns a SETOF row — PostgREST wraps it as an array
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length === 0) return null;

    const row = rows[0] as Record<string, unknown>;
    return {
      organization_id: (row.organization_id as string) ?? '',
      agency_id: (row.agency_id as string) ?? '',
      name: (row.name as string) ?? '',
      logo_url: (row.logo_url as string | null) ?? null,
      description: (row.description as string | null) ?? null,
      address_line_1: (row.address_line_1 as string | null) ?? null,
      city: (row.city as string | null) ?? null,
      postal_code: (row.postal_code as string | null) ?? null,
      country: (row.country as string | null) ?? null,
      website_url: (row.website_url as string | null) ?? null,
    };
  } catch (e) {
    console.error('[getPublicAgencyProfile] exception:', e);
    return null;
  }
}

/**
 * Public-safe measurements and display fields for a single model.
 * Returned by get_public_model_profile RPC. Zero values are normalised to null server-side.
 * Never includes PII (user_id, email, phone, is_minor, photo URLs, internal flags).
 */
export interface PublicModelProfile {
  id: string;
  name: string;
  sex: string | null;
  height: number | null;
  bust: number | null;
  chest: number | null;
  waist: number | null;
  hips: number | null;
  legs_inseam: number | null;
  shoe_size: number | null;
  hair_color: string | null;
  eye_color: string | null;
  city: string | null;
  country: string | null;
  mother_agency_name: string | null;
}

/**
 * Fetches public-safe measurements for a single model.
 *
 * Verifies the agency slug resolves to a public agency AND the model
 * belongs to that agency with an active relationship — both enforced server-side.
 *
 * Returns null when: inputs are empty, slug not found, agency not public,
 * model not in that agency's roster, or any RPC error.
 *
 * Safe for unauthenticated callers (anon Supabase key).
 */
export async function getPublicModelProfile(
  agencySlug: string,
  modelId: string,
): Promise<PublicModelProfile | null> {
  if (!agencySlug || !modelId) return null;

  try {
    const { data, error } = await supabase.rpc('get_public_model_profile', {
      p_agency_slug: agencySlug,
      p_model_id: modelId,
    });

    if (error) {
      console.error('[getPublicModelProfile] RPC error:', error);
      return null;
    }

    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length === 0) return null;

    const row = rows[0] as Record<string, unknown>;
    return {
      id: (row.id as string) ?? '',
      name: (row.name as string) ?? '',
      sex: (row.sex as string | null) ?? null,
      height: (row.height as number | null) ?? null,
      bust: (row.bust as number | null) ?? null,
      chest: (row.chest as number | null) ?? null,
      waist: (row.waist as number | null) ?? null,
      hips: (row.hips as number | null) ?? null,
      legs_inseam: (row.legs_inseam as number | null) ?? null,
      shoe_size: (row.shoe_size as number | null) ?? null,
      hair_color: (row.hair_color as string | null) ?? null,
      eye_color: (row.eye_color as string | null) ?? null,
      city: (row.city as string | null) ?? null,
      country: (row.country as string | null) ?? null,
      mother_agency_name: (row.mother_agency_name as string | null) ?? null,
    };
  } catch (e) {
    console.error('[getPublicModelProfile] exception:', e);
    return null;
  }
}

/**
 * One portfolio photo row, returned by the anon-accessible model_photos query.
 * Anon RLS policy (20260817): is_visible_to_clients = true AND photo_type = 'portfolio'.
 */
export interface PublicModelPhoto {
  id: string;
  url: string;
  sort_order: number | null;
}

/**
 * Fetches public portfolio photos for a single model.
 *
 * Queries model_photos directly — the anon RLS policy allows SELECT where
 * is_visible_to_clients = true AND photo_type = 'portfolio' (no auth required).
 * Results are ordered by sort_order ascending (NULLs last).
 *
 * Safe for unauthenticated callers (anon Supabase key).
 */
export async function getPublicModelPhotos(modelId: string): Promise<PublicModelPhoto[]> {
  if (!modelId) return [];
  try {
    const { data, error } = await supabase
      .from('model_photos')
      .select('id, url, sort_order')
      .eq('model_id', modelId)
      .eq('photo_type', 'portfolio')
      .eq('is_visible_to_clients', true)
      .order('sort_order', { ascending: true });
    if (error) {
      console.error('[getPublicModelPhotos] query error:', error);
      return [];
    }
    const rows = Array.isArray(data) ? data : [];
    return rows.map((row: Record<string, unknown>) => ({
      id: (row.id as string) ?? '',
      url: (row.url as string) ?? '',
      sort_order: (row.sort_order as number | null) ?? null,
    }));
  } catch (e) {
    console.error('[getPublicModelPhotos] exception:', e);
    return [];
  }
}

/**
 * Fetches the public model roster for an agency.
 *
 * Returns only: id, name, sex, cover_url (first portfolio image).
 *
 * Server-side filter (migration `20260904_shadow_paths_canonical_guards.sql`): rows with
 * `agency_relationship_status = 'active'` only, and either `user_id IS NOT NULL` or an
 * existing `model_agency_territories` row for `(model_id, agency_id)`. Stricter than the
 * internal agency roster (`getModelsForAgencyFromSupabase`): public is `active` only + gate;
 * internal roster is MAT-driven and may include `pending_link` / null relationship for models
 * still represented in MAT.
 *
 * The `get_public_agency_models` RPC also participates in the public profile gate: no rows
 * unless the org is type `agency` with `organization_profiles.is_public = true` (see RPC definition).
 *
 * The agencyId should normally be obtained from getPublicAgencyProfile.
 *
 * Safe for unauthenticated callers (anon Supabase key).
 */
export async function getPublicAgencyModels(agencyId: string): Promise<PublicAgencyModel[]> {
  if (!agencyId) return [];

  try {
    const { data, error } = await supabase.rpc('get_public_agency_models', {
      p_agency_id: agencyId,
    });

    if (error) {
      console.error('[getPublicAgencyModels] RPC error:', error);
      return [];
    }

    const rows = Array.isArray(data) ? data : data ? [data] : [];
    return rows.map((row: Record<string, unknown>) => ({
      id: (row.id as string) ?? '',
      name: (row.name as string) ?? '',
      sex: (row.sex as string | null) ?? null,
      cover_url: (row.cover_url as string | null) ?? null,
    }));
  } catch (e) {
    console.error('[getPublicAgencyModels] exception:', e);
    return [];
  }
}
