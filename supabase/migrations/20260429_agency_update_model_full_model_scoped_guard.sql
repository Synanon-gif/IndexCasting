-- =============================================================================
-- agency_update_model_full: model-scoped agency membership guard
-- Date: 2026-04-29
--
-- PROBLEM:
--   Previous guard resolved the caller agency via ORDER BY om.created_at ASC LIMIT 1
--   on organization_members (type=agency), then required model.agency_id = that id.
--   save_model_territories and related RPCs instead check membership for the explicit
--   agency_id tied to the model/operation. Multi-org bookers (or any mismatch between
--   profile-resolved agency and LIMIT 1) could pass territory save but fail
--   agency_update_model_full with model_not_in_agency → HTTP 400.
--
-- FIX:
--   Authorize against models.agency_id: same EXISTS pattern as save_model_territories
--   (org_members + type=agency + bookers). Unowned models (agency_id IS NULL): require
--   any agency membership or bookers row. Admins: is_current_user_admin() bypass.
--
-- Idempotent: CREATE OR REPLACE. No signature change.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.agency_update_model_full(
  p_model_id                     uuid,
  p_name                         text        DEFAULT NULL,
  p_email                        text        DEFAULT NULL,
  p_phone                        text        DEFAULT NULL,
  p_city                         text        DEFAULT NULL,
  p_country                      text        DEFAULT NULL,
  p_country_code                 text        DEFAULT NULL,
  p_current_location             text        DEFAULT NULL,
  p_height                       integer     DEFAULT NULL,
  p_bust                         integer     DEFAULT NULL,
  p_waist                        integer     DEFAULT NULL,
  p_hips                         integer     DEFAULT NULL,
  p_chest                        integer     DEFAULT NULL,
  p_legs_inseam                  integer     DEFAULT NULL,
  p_shoe_size                    integer     DEFAULT NULL,
  p_hair_color                   text        DEFAULT NULL,
  p_eye_color                    text        DEFAULT NULL,
  p_sex                          text        DEFAULT NULL,
  p_ethnicity                    text        DEFAULT NULL,
  p_categories                   text[]      DEFAULT NULL,
  p_is_visible_fashion           boolean     DEFAULT NULL,
  p_is_visible_commercial        boolean     DEFAULT NULL,
  p_is_active                    boolean     DEFAULT NULL,
  p_is_sports_winter             boolean     DEFAULT NULL,
  p_is_sports_summer             boolean     DEFAULT NULL,
  p_portfolio_images             text[]      DEFAULT NULL,
  p_polaroids                    text[]      DEFAULT NULL,
  p_video_url                    text        DEFAULT NULL,
  p_polas_source                 text        DEFAULT NULL,
  p_show_polas_on_profile        boolean     DEFAULT NULL,
  p_agency_relationship_status   text        DEFAULT NULL,
  p_agency_relationship_ended_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_model_agency_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT agency_id INTO v_model_agency_id
  FROM public.models
  WHERE id = p_model_id;

  IF NOT public.is_current_user_admin() THEN
    IF v_model_agency_id IS NOT NULL THEN
      IF NOT (
        EXISTS (
          SELECT 1
          FROM public.organization_members om
          JOIN public.organizations o ON o.id = om.organization_id
          WHERE om.user_id = auth.uid()
            AND o.agency_id = v_model_agency_id
            AND o.type = 'agency'
        )
        OR EXISTS (
          SELECT 1
          FROM public.bookers b
          WHERE b.agency_id = v_model_agency_id
            AND b.user_id = auth.uid()
        )
      ) THEN
        RAISE EXCEPTION 'model_not_in_agency';
      END IF;
    ELSE
      -- Unowned row: any agency-linked membership (or legacy booker) may edit via this RPC.
      IF NOT (
        EXISTS (
          SELECT 1
          FROM public.organization_members om
          JOIN public.organizations o ON o.id = om.organization_id
          WHERE om.user_id = auth.uid()
            AND o.agency_id IS NOT NULL
            AND o.type = 'agency'
        )
        OR EXISTS (
          SELECT 1 FROM public.bookers b WHERE b.user_id = auth.uid()
        )
      ) THEN
        RAISE EXCEPTION 'not_in_agency';
      END IF;
    END IF;
  END IF;

  UPDATE public.models SET
    name                         = COALESCE(p_name,                         name),
    email                        = COALESCE(p_email,                        email),
    phone                        = COALESCE(p_phone,                        phone),
    city                         = COALESCE(p_city,                         city),
    country                      = COALESCE(p_country,                      country),
    country_code                 = COALESCE(p_country_code,                 country_code),
    current_location             = COALESCE(p_current_location,             current_location),
    height                       = COALESCE(p_height,                       height),
    bust                         = COALESCE(p_bust,                         bust),
    waist                        = COALESCE(p_waist,                        waist),
    hips                         = COALESCE(p_hips,                         hips),
    chest                        = COALESCE(p_chest,                        chest),
    legs_inseam                  = COALESCE(p_legs_inseam,                  legs_inseam),
    shoe_size                    = COALESCE(p_shoe_size,                    shoe_size),
    hair_color                   = COALESCE(p_hair_color,                   hair_color),
    eye_color                    = COALESCE(p_eye_color,                    eye_color),
    sex                          = COALESCE(p_sex,                          sex),
    ethnicity                    = COALESCE(p_ethnicity,                    ethnicity),
    categories                   = CASE
                                     WHEN p_categories IS NULL THEN categories
                                     WHEN array_length(p_categories, 1) IS NULL THEN NULL
                                     ELSE p_categories
                                   END,
    is_visible_fashion           = COALESCE(p_is_visible_fashion,           is_visible_fashion),
    is_visible_commercial        = COALESCE(p_is_visible_commercial,        is_visible_commercial),
    is_active                    = COALESCE(p_is_active,                    is_active),
    is_sports_winter             = COALESCE(p_is_sports_winter,             is_sports_winter),
    is_sports_summer             = COALESCE(p_is_sports_summer,             is_sports_summer),
    portfolio_images             = COALESCE(p_portfolio_images,             portfolio_images),
    polaroids                    = COALESCE(p_polaroids,                    polaroids),
    video_url                    = COALESCE(p_video_url,                    video_url),
    polas_source                 = COALESCE(p_polas_source,                 polas_source),
    show_polas_on_profile        = COALESCE(p_show_polas_on_profile,        show_polas_on_profile),
    agency_relationship_status   = COALESCE(p_agency_relationship_status,   agency_relationship_status),
    agency_relationship_ended_at = COALESCE(p_agency_relationship_ended_at, agency_relationship_ended_at)
  WHERE id = p_model_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.agency_update_model_full FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_update_model_full TO authenticated;

COMMENT ON FUNCTION public.agency_update_model_full IS
  'FIXED (20260429): membership checked against models.agency_id (same pattern as save_model_territories); '
  'admin bypass via is_current_user_admin(); no implicit LIMIT 1 caller-agency resolution.';
