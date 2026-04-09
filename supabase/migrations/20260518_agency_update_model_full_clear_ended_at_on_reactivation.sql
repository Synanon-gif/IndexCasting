-- =============================================================================
-- agency_update_model_full: clear agency_relationship_ended_at on reactivation
-- Date: 2026-05-18
--
-- PROBLEM:
--   COALESCE(p_agency_relationship_ended_at, agency_relationship_ended_at)
--   can never set ended_at to NULL because NULL coalesces to the old value.
--   When a soft-removed model is re-added (status changes from 'ended' to
--   'active' or 'pending_link'), the old timestamp stays — misleading for
--   roster reporting and debugging.
--
-- FIX:
--   When p_agency_relationship_status is 'active' or 'pending_link',
--   force agency_relationship_ended_at to NULL regardless of old value.
--   Otherwise keep the existing COALESCE behavior.
--
-- Idempotent: CREATE OR REPLACE. Same signature as 20260430.
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
            AND o.type = 'agency'
            AND o.agency_id = v_model_agency_id
        )
        OR EXISTS (
          SELECT 1 FROM public.bookers
          WHERE agency_id = v_model_agency_id AND user_id = auth.uid()
        )
      ) THEN
        RAISE EXCEPTION 'model_not_in_agency';
      END IF;
    ELSE
      IF NOT (
        EXISTS (
          SELECT 1
          FROM public.organization_members om
          JOIN public.organizations o ON o.id = om.organization_id
          WHERE om.user_id = auth.uid()
            AND o.type = 'agency'
        )
        OR EXISTS (
          SELECT 1 FROM public.bookers
          WHERE user_id = auth.uid()
        )
      ) THEN
        RAISE EXCEPTION 'not_in_any_agency';
      END IF;
    END IF;
  END IF;

  UPDATE public.models SET
    name                         = COALESCE(p_name,                         name),
    email                        = COALESCE(p_email,                        email),
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
    categories                   = COALESCE(p_categories,                   categories),
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
    agency_relationship_ended_at = CASE
      WHEN p_agency_relationship_status IN ('active', 'pending_link') THEN NULL
      ELSE COALESCE(p_agency_relationship_ended_at, agency_relationship_ended_at)
    END
  WHERE id = p_model_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.agency_update_model_full FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_update_model_full TO authenticated;

COMMENT ON FUNCTION public.agency_update_model_full IS
  'FIXED (20260429): model-scoped membership + admin bypass. '
  'FIXED (20260430): no models.phone column — p_phone accepted for compat, not written. '
  'FIXED (20260518): clear agency_relationship_ended_at when re-activating (status→active/pending_link).';
