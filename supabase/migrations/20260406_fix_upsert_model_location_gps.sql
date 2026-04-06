-- =============================================================================
-- Fix: upsert_model_location — preserve model GPS when agency updates city/country
-- Date: 2026-04-06
--
-- Bug: When an agency saves a model's city/country via upsertModelLocation
--      (source='agency', share_approximate_location=false), the ON CONFLICT clause
--      unconditionally set:
--        lat_approx  = NULL  (p_share_approximate_location=false → ELSE NULL)
--        lng_approx  = NULL
--        share_approximate_location = false
--
--      This meant: if a model had previously enabled GPS sharing (source='model',
--      share_approximate_location=true, lat/lng set), any agency profile-save
--      would wipe the model's GPS data → model disappeared from Near-Me search.
--
-- bulk_upsert_model_locations already had this fix (preserves share_approximate_location
-- on conflict). upsert_model_location (single-model path used in AgencyControllerView)
-- did not.
--
-- Fix: When source='agency' in ON CONFLICT, preserve the existing:
--   - lat_approx
--   - lng_approx
--   - share_approximate_location
-- Only update city, country_code, source, updated_at from the agency write.
--
-- Security note: The original function was SECURITY INVOKER (RLS-based). The new
-- version is SECURITY DEFINER with SET row_security TO off and explicit guards,
-- consistent with bulk_upsert_model_locations and the SECURITY DEFINER pattern
-- required for all functions reading RLS-protected tables (Rule 21).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.upsert_model_location(
  p_model_id                    uuid,
  p_country_code                text,
  p_city                        text        DEFAULT NULL,
  p_lat_approx                  float       DEFAULT NULL,
  p_lng_approx                  float       DEFAULT NULL,
  p_share_approximate_location  boolean     DEFAULT TRUE,
  p_source                      text        DEFAULT 'model'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_lat float := CASE WHEN p_lat_approx IS NOT NULL
                      THEN ROUND(p_lat_approx::numeric, 2)::float
                      ELSE NULL END;
  v_lng float := CASE WHEN p_lng_approx IS NOT NULL
                      THEN ROUND(p_lng_approx::numeric, 2)::float
                      ELSE NULL END;
BEGIN
  -- GUARD 1: Must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- GUARD 2: Source validation
  IF p_source NOT IN ('model', 'agency') THEN
    RAISE EXCEPTION 'Invalid source value: %', p_source;
  END IF;

  -- GUARD 3: Caller must own the model (model user) OR be an agency member / booker
  IF NOT (
    -- The model's own user
    EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = p_model_id AND m.user_id = auth.uid()
    )
    -- Agency org member managing this model
    OR EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id AND o.type = 'agency'
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.id = p_model_id AND om.user_id = auth.uid()
    )
    -- Legacy booker managing this model
    OR EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.bookers b ON b.agency_id = m.agency_id
      WHERE m.id = p_model_id AND b.user_id = auth.uid()
    )
    -- Admin override
    OR public.is_current_user_admin()
  ) THEN
    RAISE EXCEPTION 'access_denied: caller does not manage model %', p_model_id;
  END IF;

  INSERT INTO public.model_locations (
    model_id, country_code, city, lat_approx, lng_approx,
    share_approximate_location, source, updated_at
  )
  VALUES (
    p_model_id,
    UPPER(TRIM(p_country_code)),
    NULLIF(TRIM(COALESCE(p_city, '')), ''),
    -- On first insert for agency: store NULL (agency has no GPS)
    CASE WHEN p_share_approximate_location THEN v_lat ELSE NULL END,
    CASE WHEN p_share_approximate_location THEN v_lng ELSE NULL END,
    -- Agency always inserts with false (model controls GPS consent)
    CASE WHEN p_source = 'agency' THEN FALSE ELSE p_share_approximate_location END,
    p_source,
    now()
  )
  ON CONFLICT (model_id) DO UPDATE SET
    country_code = UPPER(TRIM(p_country_code)),
    city         = NULLIF(TRIM(COALESCE(p_city, '')), ''),

    -- GPS PRESERVATION RULE:
    --   source='agency' → NEVER overwrite the model's own GPS data.
    --   The agency only sets city/country for display; the model controls GPS sharing.
    --   source='model'  → update lat/lng based on the model's own consent flag.
    lat_approx = CASE
      WHEN p_source = 'agency' THEN model_locations.lat_approx         -- preserve model GPS
      WHEN p_share_approximate_location THEN ROUND(COALESCE(v_lat, 0)::numeric, 2)::float
      ELSE NULL
    END,
    lng_approx = CASE
      WHEN p_source = 'agency' THEN model_locations.lng_approx         -- preserve model GPS
      WHEN p_share_approximate_location THEN ROUND(COALESCE(v_lng, 0)::numeric, 2)::float
      ELSE NULL
    END,
    share_approximate_location = CASE
      WHEN p_source = 'agency' THEN model_locations.share_approximate_location  -- preserve model consent
      ELSE p_share_approximate_location
    END,

    source     = p_source,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_model_location(
  uuid, text, text, float, float, boolean, text
) TO authenticated;

COMMENT ON FUNCTION public.upsert_model_location IS
  'FIXED (20260406): agency writes (source=''agency'') no longer overwrite model GPS data. '
  'lat_approx, lng_approx, share_approximate_location are preserved on conflict when source=''agency''. '
  'Changed from SECURITY INVOKER to SECURITY DEFINER with explicit guards (Rule 21). '
  'Consistent with bulk_upsert_model_locations GPS-preservation fix (20260406_location_filter_consistency).';

-- ── Verification ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'upsert_model_location'
      AND p.prosecdef = true  -- SECURITY DEFINER
  ), 'upsert_model_location must be SECURITY DEFINER';
  RAISE NOTICE 'upsert_model_location: GPS-preservation fix verified OK';
END $$;
