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
 * Fetches the public model roster for an agency.
 *
 * Returns only: id, name, sex, cover_url (first portfolio image).
 *
 * Server-side filter (migration `20260904_shadow_paths_canonical_guards.sql`): rows with
 * `agency_relationship_status = 'active'` only, and either `user_id IS NOT NULL` or an
 * existing `model_agency_territories` row for `(model_id, agency_id)`. Stricter than the
 * internal agency roster (`getModelsForAgencyFromSupabase`), which may include
 * `pending_link` / null relationship before MAT+eligibility filtering.
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
