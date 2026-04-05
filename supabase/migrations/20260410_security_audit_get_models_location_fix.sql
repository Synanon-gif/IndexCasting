-- =============================================================================
-- Migration: 20260410_security_audit_get_models_location_fix.sql
--
-- Fixes:
--   K-2 (CRITICAL): get_models_by_location verwendete SELECT m.* und
--         lieferte damit email, phone, admin_notes, sync-IDs und alle
--         internen Felder an jeden subscribed Client-User — direktes DSGVO-
--         Datenleck. Fix: explizite Spaltenauswahl ohne PII.
--
--   M-2 (MEDIUM): Die letzte Version (#163) enthielt kein AND m.is_active = TRUE
--         — inaktive Models erschienen in der Discovery.
--         Fix: is_active-Filter wiederhergestellt.
--
-- Die Funktionssignatur (Parameter) bleibt identisch — kein Breaking Change.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_models_by_location(
  p_iso             text,
  p_client_type     text      DEFAULT 'all',
  p_from            integer   DEFAULT 0,
  p_to              integer   DEFAULT 999,
  p_city            text      DEFAULT NULL,
  p_category        text      DEFAULT NULL,
  p_sports_winter   boolean   DEFAULT FALSE,
  p_sports_summer   boolean   DEFAULT FALSE,
  p_height_min      integer   DEFAULT NULL,
  p_height_max      integer   DEFAULT NULL,
  p_hair_color      text      DEFAULT NULL,
  p_hips_min        integer   DEFAULT NULL,
  p_hips_max        integer   DEFAULT NULL,
  p_waist_min       integer   DEFAULT NULL,
  p_waist_max       integer   DEFAULT NULL,
  p_chest_min       integer   DEFAULT NULL,
  p_chest_max       integer   DEFAULT NULL,
  p_legs_inseam_min integer   DEFAULT NULL,
  p_legs_inseam_max integer   DEFAULT NULL,
  p_sex             text      DEFAULT NULL,
  p_ethnicities     text[]    DEFAULT NULL
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Paywall-Enforcement: nur authenticated mit aktivem Plan.
  -- Anon-Zugriff wurde separat via migration_security_revoke_anon_location_rpc.sql revoked.
  IF auth.role() = 'authenticated' THEN
    IF NOT public.has_platform_access() THEN
      RAISE EXCEPTION 'platform_access_denied'
        USING HINT    = 'Active subscription or trial required to discover models.',
              ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN QUERY
  SELECT to_jsonb(result)
  FROM (
    SELECT
      -- K-2: Explizite Spaltenauswahl — kein m.* mehr.
      -- Ausgeschlossen: email, phone, admin_notes, mediaslide_sync_id,
      --   mediaslide_model_id, netwalk_model_id, is_minor (intern/PII).
      m.id,
      m.name,
      m.city,
      m.country,
      m.country_code,
      m.current_location,
      m.height,
      m.bust,
      m.waist,
      m.hips,
      m.chest,
      m.legs_inseam,
      m.shoe_size,
      m.hair_color,
      m.eye_color,
      m.sex,
      m.ethnicity,
      m.categories,
      m.is_visible_fashion,
      m.is_visible_commercial,
      m.is_active,
      m.is_sports_winter,
      m.is_sports_summer,
      m.portfolio_images,
      m.polaroids,
      m.video_url,
      m.polas_source,
      m.show_polas_on_profile,
      m.agency_id,
      m.agency_relationship_status,
      m.user_id,
      m.created_at,
      m.updated_at,
      -- Territory + Agency-Felder für Client-Kontext
      mat.country_code  AS territory_country_code,
      a.name            AS agency_name,
      mat.agency_id     AS territory_agency_id
    FROM public.models m
    JOIN public.model_agency_territories mat ON mat.model_id = m.id
    JOIN public.agencies                 a   ON a.id         = mat.agency_id
    WHERE
      mat.country_code = p_iso
      -- M-2: is_active-Filter wiederhergestellt (war in #163 weggefallen)
      AND m.is_active = TRUE
      AND (
        m.agency_relationship_status IS NULL
        OR m.agency_relationship_status IN ('active', 'pending_link')
      )
      AND (
        p_client_type = 'all'
        OR (p_client_type = 'fashion'    AND m.is_visible_fashion    = TRUE)
        OR (p_client_type = 'commercial' AND m.is_visible_commercial = TRUE)
      )
      AND (NOT p_sports_winter OR m.is_sports_winter = TRUE)
      AND (NOT p_sports_summer OR m.is_sports_summer = TRUE)
      AND (p_height_min      IS NULL OR m.height      >= p_height_min)
      AND (p_height_max      IS NULL OR m.height      <= p_height_max)
      AND (p_hips_min        IS NULL OR m.hips        >= p_hips_min)
      AND (p_hips_max        IS NULL OR m.hips        <= p_hips_max)
      AND (p_waist_min       IS NULL OR m.waist       >= p_waist_min)
      AND (p_waist_max       IS NULL OR m.waist       <= p_waist_max)
      AND (p_chest_min       IS NULL OR m.chest       >= p_chest_min)
      AND (p_chest_max       IS NULL OR m.chest       <= p_chest_max)
      AND (p_legs_inseam_min IS NULL OR m.legs_inseam >= p_legs_inseam_min)
      AND (p_legs_inseam_max IS NULL OR m.legs_inseam <= p_legs_inseam_max)
      AND (p_sex             IS NULL OR m.sex         =  p_sex)
      AND (
        p_hair_color IS NULL OR p_hair_color = ''
        OR m.hair_color ILIKE ('%' || p_hair_color || '%')
      )
      AND (
        p_city IS NULL OR p_city = ''
        OR m.city ILIKE p_city
      )
      AND (
        p_category IS NULL
        OR m.categories IS NULL
        OR m.categories = '{}'
        OR m.categories @> ARRAY[p_category]
      )
      AND (
        p_ethnicities IS NULL
        OR array_length(p_ethnicities, 1) IS NULL
        OR m.ethnicity = ANY(p_ethnicities)
      )
    ORDER BY m.name
    OFFSET p_from
    LIMIT  (p_to - p_from + 1)
  ) result;
END;
$$;

-- Grants: nur authenticated (anon wurde via migration_security_revoke_anon_location_rpc.sql revoked)
REVOKE ALL ON FUNCTION public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) TO authenticated;

COMMENT ON FUNCTION public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) IS
  'K-2/M-2 Security Audit 2026-04-05: Explizite Spaltenauswahl (kein m.*) — '
  'email, phone, admin_notes, sync-IDs werden nicht mehr zurückgegeben. '
  'is_active = TRUE Filter wiederhergestellt. '
  'Paywall via has_platform_access() enforced. Anon-Zugriff revoked.';

-- Verifikation
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'get_models_by_location'
  ), 'get_models_by_location nicht gefunden';

  RAISE NOTICE 'Migration 20260410_security_audit_get_models_location_fix: OK';
END $$;
