/**
 * Public Client Profile Service — Phase 3B.1
 *
 * Provides public-safe data access for client organization profiles.
 * No authentication required; both functions call SECURITY DEFINER RPCs
 * that enforce is_public=true + type='client' guards server-side.
 *
 * Allowlisted fields only — no PII, no org-member data, no internal fields.
 * These functions deliberately do NOT use assertOrgContext (public access).
 *
 * Mirrors publicAgencyProfileSupabase.ts (Phase 3A.1).
 */

import { supabase } from '../../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Public-safe subset of organization_profiles + organizations for a client org.
 * Only fields on the explicit allowlist — no contact_email, contact_phone,
 * slug, is_public, or any internal/operational data.
 */
export interface PublicClientProfile {
  organization_id: string;
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
 * A single public gallery image from organization_profile_media.
 * Only id, image_url, title, and sort_order are exposed.
 */
export interface PublicClientGalleryItem {
  id: string;
  image_url: string;
  title: string | null;
  sort_order: number;
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Fetches a public client profile by slug.
 *
 * Returns null when:
 *   - slug not found
 *   - profile exists but is_public = false
 *   - organization type ≠ 'client'
 *
 * Safe for unauthenticated callers (anon Supabase key).
 */
export async function getPublicClientProfile(
  slug: string,
): Promise<PublicClientProfile | null> {
  if (!slug) return null;

  try {
    const { data, error } = await supabase.rpc('get_public_client_profile', {
      p_slug: slug,
    });

    if (error) {
      console.error('[getPublicClientProfile] RPC error:', error);
      return null;
    }

    // RPC returns a SETOF row — PostgREST wraps it as an array
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length === 0) return null;

    const row = rows[0] as Record<string, unknown>;
    return {
      organization_id: (row.organization_id as string) ?? '',
      name:            (row.name as string) ?? '',
      logo_url:        (row.logo_url as string | null) ?? null,
      description:     (row.description as string | null) ?? null,
      address_line_1:  (row.address_line_1 as string | null) ?? null,
      city:            (row.city as string | null) ?? null,
      postal_code:     (row.postal_code as string | null) ?? null,
      country:         (row.country as string | null) ?? null,
      website_url:     (row.website_url as string | null) ?? null,
    };
  } catch (e) {
    console.error('[getPublicClientProfile] exception:', e);
    return null;
  }
}

/**
 * Fetches the public gallery for a client organization.
 *
 * Returns only: id, image_url, title, sort_order.
 * Filters to media_type='client_gallery' only.
 *
 * The organizationId should be obtained from getPublicClientProfile, which
 * already enforces the is_public guard and type='client' guard.
 *
 * Safe for unauthenticated callers (anon Supabase key).
 */
export async function getPublicClientGallery(
  organizationId: string,
): Promise<PublicClientGalleryItem[]> {
  if (!organizationId) return [];

  try {
    const { data, error } = await supabase.rpc('get_public_client_gallery', {
      p_organization_id: organizationId,
    });

    if (error) {
      console.error('[getPublicClientGallery] RPC error:', error);
      return [];
    }

    const rows = Array.isArray(data) ? data : data ? [data] : [];
    return rows.map((row: Record<string, unknown>) => ({
      id:         (row.id as string) ?? '',
      image_url:  (row.image_url as string) ?? '',
      title:      (row.title as string | null) ?? null,
      sort_order: (row.sort_order as number) ?? 0,
    }));
  } catch (e) {
    console.error('[getPublicClientGallery] exception:', e);
    return [];
  }
}
