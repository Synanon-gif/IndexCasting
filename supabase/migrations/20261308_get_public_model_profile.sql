-- Phase 3.2: Public model profile — measurements-only RPC for unauthenticated access.
--
-- Security model (SECURITY DEFINER, row_security=off):
--   • p_agency_slug → organization_profiles.slug gate enforces caller knows the slug
--   • is_public = true + organizations.type = 'agency' enforces public profile gate
--   • models.agency_id = organizations.agency_id enforces model belongs to that agency
--   • agency_relationship_status must be 'active' or NULL (legacy legacy rows)
--   • GRANT to anon so anon Supabase key can call without a session
--
-- Allowlist (only these fields returned):
--   id, name, sex, height, bust, chest, waist, hips, legs_inseam, shoe_size,
--   hair_color, eye_color, city, country, mother_agency_name
--
-- Never exposed:
--   user_id, email, phone, date_of_birth, is_minor, notes, portfolio_images,
--   agency_relationship_status, internal flags, any joined private tables

CREATE OR REPLACE FUNCTION public.get_public_model_profile(
  p_agency_slug text,
  p_model_id    uuid
)
RETURNS TABLE (
  id                 uuid,
  name               text,
  sex                text,
  height             integer,
  bust               integer,
  chest              integer,
  waist              integer,
  hips               integer,
  legs_inseam        integer,
  shoe_size          integer,
  hair_color         text,
  eye_color          text,
  city               text,
  country            text,
  mother_agency_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  -- Fail-closed on empty inputs: no slug or no model UUID → no rows.
  IF p_agency_slug IS NULL OR BTRIM(p_agency_slug) = '' OR p_model_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      m.id                                    AS id,
      m.name::text                            AS name,
      m.sex::text                             AS sex,
      -- Zero stored as NULL: 0 means "not set" in this schema
      NULLIF(m.height,      0)                AS height,
      NULLIF(m.bust,        0)                AS bust,
      NULLIF(m.chest,       0)                AS chest,
      NULLIF(m.waist,       0)                AS waist,
      NULLIF(m.hips,        0)                AS hips,
      NULLIF(m.legs_inseam, 0)               AS legs_inseam,
      NULLIF(m.shoe_size,   0)               AS shoe_size,
      NULLIF(BTRIM(m.hair_color),        '') AS hair_color,
      NULLIF(BTRIM(m.eye_color),         '') AS eye_color,
      NULLIF(BTRIM(m.city),              '') AS city,
      NULLIF(BTRIM(m.country),           '') AS country,
      NULLIF(BTRIM(m.mother_agency_name),'') AS mother_agency_name
    FROM public.organization_profiles op
    JOIN public.organizations o   ON o.id          = op.organization_id
    JOIN public.models m          ON m.agency_id   = o.agency_id
    WHERE op.slug        = p_agency_slug
      AND op.is_public   = true
      AND o.type         = 'agency'
      AND o.agency_id    IS NOT NULL
      AND m.id           = p_model_id
      AND (
        m.agency_relationship_status IS NULL
        OR m.agency_relationship_status = 'active'
      );
END;
$$;

COMMENT ON FUNCTION public.get_public_model_profile(text, uuid) IS
  'Phase 3.2 public stats RPC. Returns measurement fields for a single model when the '
  'agency slug resolves to a public agency and the model has an active relationship with it. '
  'No auth required. Allowlisted fields only — no PII, no photo URLs, no internal flags.';

GRANT EXECUTE ON FUNCTION public.get_public_model_profile(text, uuid) TO anon, authenticated;


-- Post-deploy verification (run manually against your project):
--
-- SELECT proname, proconfig, proacl
-- FROM pg_proc
-- WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
--   AND proname = 'get_public_model_profile';
-- -- Expected: 1 row, proconfig includes 'row_security=off',
-- --           proacl includes anon + authenticated EXECUTE grants
--
-- -- Smoke test (replace with real values):
-- SELECT * FROM public.get_public_model_profile('your-agency-slug', 'model-uuid-here');
