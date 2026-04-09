-- ============================================================================
-- Public Client Profile RPCs — Phase 3B.1
-- 2026-05-19
--
-- Two SECURITY DEFINER functions for unauthenticated (anon) + authenticated
-- access to public client profile data.
--
-- Security model (mirrors Phase 3A.1 agency pattern):
--   - get_public_client_profile: returns data ONLY when is_public=true AND
--     organization type = 'client'. No auth.uid() check — intentionally public.
--   - get_public_client_gallery: returns only safe gallery fields from
--     organization_profile_media (media_type='client_gallery').
--     No auth.uid() check. Caller must first verify via get_public_client_profile.
--
-- Both functions bypass RLS (row_security=off) and apply their own strict
-- allowlist guards. GRANT to anon role so they work without a session.
--
-- Allowlist (public):
--   organizations.name, organization_profiles.logo_url/description/
--   address_line_1/city/postal_code/country/website_url
--   organization_profile_media.id/image_url/title/sort_order (client_gallery only)
--
-- Never exposed:
--   contact_email, contact_phone, slug, is_public, org_members, bookings,
--   chats, agency_model_cover rows, any internal operational fields
-- ============================================================================


-- ── get_public_client_profile ─────────────────────────────────────────────────
--
-- Resolves a client profile by its slug. Returns NULL (no rows) when:
--   - slug not found
--   - is_public = false
--   - organization type ≠ 'client'

CREATE OR REPLACE FUNCTION public.get_public_client_profile(p_slug text)
RETURNS TABLE (
  organization_id uuid,
  name            text,
  logo_url        text,
  description     text,
  address_line_1  text,
  city            text,
  postal_code     text,
  country         text,
  website_url     text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  -- Intentionally no auth guard: this function is designed for public access.
  -- Strict data minimization: only allowlisted columns returned.
  -- Safety: is_public AND type='client' enforced in WHERE clause.

  IF p_slug IS NULL OR trim(p_slug) = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      o.id                  AS organization_id,
      o.name::text          AS name,
      op.logo_url           AS logo_url,
      op.description        AS description,
      op.address_line_1     AS address_line_1,
      op.city               AS city,
      op.postal_code        AS postal_code,
      op.country            AS country,
      op.website_url        AS website_url
    FROM public.organization_profiles op
    JOIN public.organizations o ON o.id = op.organization_id
    WHERE op.slug     = p_slug
      AND op.is_public = true
      AND o.type      = 'client';
END;
$$;

COMMENT ON FUNCTION public.get_public_client_profile(text) IS
  'Public-safe RPC: resolves a client profile by slug. Returns data only when '
  'is_public=true AND organizations.type=''client''. No auth required. '
  'Allowlisted fields only — no PII, no org-member data, no contact details.';

GRANT EXECUTE ON FUNCTION public.get_public_client_profile(text) TO anon, authenticated;


-- ── get_public_client_gallery ─────────────────────────────────────────────────
--
-- Returns the public gallery for a client organization.
-- Only exposes: id, image_url, title, sort_order.
-- Filters to client_gallery media_type only.
--
-- The organization_id should be obtained from get_public_client_profile, which
-- already enforces the is_public guard and type='client' guard.

CREATE OR REPLACE FUNCTION public.get_public_client_gallery(p_organization_id uuid)
RETURNS TABLE (
  id         uuid,
  image_url  text,
  title      text,
  sort_order int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  -- Intentionally no auth guard: public read of gallery images.
  -- Guard: p_organization_id must be non-null (caller must already know it
  --        from get_public_client_profile, which enforces is_public + type='client').

  IF p_organization_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      opm.id               AS id,
      opm.image_url        AS image_url,
      opm.title            AS title,
      opm.sort_order       AS sort_order
    FROM public.organization_profile_media opm
    WHERE opm.organization_id = p_organization_id
      AND opm.media_type      = 'client_gallery'
    ORDER BY opm.sort_order ASC, opm.created_at ASC;
END;
$$;

COMMENT ON FUNCTION public.get_public_client_gallery(uuid) IS
  'Public-safe RPC: returns gallery images (id, image_url, title, sort_order) '
  'for a given client organization. No auth required. Only client_gallery items. '
  'Caller must obtain organization_id from get_public_client_profile (which '
  'enforces is_public guard and type=''client'' guard).';

GRANT EXECUTE ON FUNCTION public.get_public_client_gallery(uuid) TO anon, authenticated;


-- ── Post-deploy verification (run manually) ───────────────────────────────────
--
-- SELECT proname, proconfig FROM pg_proc
--   WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
--     AND proname IN ('get_public_client_profile', 'get_public_client_gallery');
-- -- Expected: 2 rows, proconfig includes 'row_security=off'
--
-- -- Test with a real slug (replace 'my-slug' as needed):
-- SELECT * FROM public.get_public_client_profile('my-slug');
