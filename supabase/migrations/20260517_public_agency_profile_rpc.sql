-- ============================================================================
-- Public Agency Profile RPCs — Phase 3A.1
-- 2026-05-17
--
-- Two SECURITY DEFINER functions for unauthenticated (anon) + authenticated
-- access to public agency profile data.
--
-- Security model:
--   - get_public_agency_profile: returns data ONLY when is_public=true AND
--     organization type = 'agency'. No auth.uid() check — intentionally public.
--   - get_public_agency_models: returns only 4 non-sensitive fields. No PII.
--     Filters to agency_id + active relationship. No auth.uid() check.
--
-- Both functions bypass RLS (row_security=off) and apply their own strict
-- allowlist guards. GRANT to anon role so they work without a session.
--
-- Allowlist (public):
--   organizations.name, organization_profiles.logo_url/description/
--   address_line_1/city/postal_code/country/website_url
--   models.id/name/sex/portfolio_images[1]
--
-- Never exposed:
--   contact_email, contact_phone, slug, org_members, bookings, chats,
--   model personal data beyond name+sex+first portfolio image
-- ============================================================================


-- ── get_public_agency_profile ─────────────────────────────────────────────────
--
-- Resolves an agency profile by its slug. Returns NULL (no rows) when:
--   - slug not found
--   - is_public = false
--   - organization type ≠ 'agency'

CREATE OR REPLACE FUNCTION public.get_public_agency_profile(p_slug text)
RETURNS TABLE (
  organization_id uuid,
  agency_id       uuid,
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
  -- Safety: is_public AND type='agency' enforced in WHERE clause.

  RETURN QUERY
    SELECT
      o.id                  AS organization_id,
      o.agency_id           AS agency_id,
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
    WHERE op.slug    = p_slug
      AND op.is_public = true
      AND o.type    = 'agency';
END;
$$;

COMMENT ON FUNCTION public.get_public_agency_profile(text) IS
  'Public-safe RPC: resolves an agency profile by slug. Returns data only when '
  'is_public=true AND organizations.type=''agency''. No auth required. '
  'Allowlisted fields only — no PII, no org-member data.';

GRANT EXECUTE ON FUNCTION public.get_public_agency_profile(text) TO anon, authenticated;


-- ── get_public_agency_models ──────────────────────────────────────────────────
--
-- Returns the minimal public model roster for an agency.
-- Only exposes: id, name, sex, first portfolio image URL.
-- Filters to active agency relationship only.

CREATE OR REPLACE FUNCTION public.get_public_agency_models(p_agency_id uuid)
RETURNS TABLE (
  id        uuid,
  name      text,
  sex       text,
  cover_url text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  -- Intentionally no auth guard: public read of non-sensitive model roster.
  -- Guard: p_agency_id must be non-null (caller must already know it from
  --        get_public_agency_profile, which enforces is_public + type='agency').

  IF p_agency_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      m.id                                      AS id,
      m.name::text                              AS name,
      m.sex::text                               AS sex,
      (m.portfolio_images[1])::text             AS cover_url
    FROM public.models m
    WHERE m.agency_id = p_agency_id
      AND (
        m.agency_relationship_status IS NULL
        OR m.agency_relationship_status = 'active'
      )
    ORDER BY m.name;
END;
$$;

COMMENT ON FUNCTION public.get_public_agency_models(uuid) IS
  'Public-safe RPC: returns the minimal model roster (id, name, sex, cover_url) '
  'for a given agency. No auth required. Only active agency relationships. '
  'Caller must obtain agency_id from get_public_agency_profile (which enforces '
  'is_public guard).';

GRANT EXECUTE ON FUNCTION public.get_public_agency_models(uuid) TO anon, authenticated;


-- ── Post-deploy verification (run manually) ───────────────────────────────────
--
-- SELECT proname, proconfig FROM pg_proc
--   WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
--     AND proname IN ('get_public_agency_profile', 'get_public_agency_models');
-- -- Expected: 2 rows, proconfig includes 'row_security=off'
--
-- -- Test with a real slug (replace 'my-slug' as needed):
-- SELECT * FROM public.get_public_agency_profile('my-slug');
