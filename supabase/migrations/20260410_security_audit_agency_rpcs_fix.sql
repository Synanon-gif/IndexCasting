-- =============================================================================
-- Migration: 20260410_security_audit_agency_rpcs_fix.sql
--
-- Fixes:
--   H-1 (HIGH): agency_claim_unowned_model — GET DIAGNOSTICS ROW_COUNT nach
--         UPDATE. Wenn 0 Zeilen betroffen (Race Condition: anderer Caller
--         hat das Model schon geclaimt), RAISE EXCEPTION 'model_already_claimed'.
--         Vorher: stilles No-Op, Frontend erhielt void ohne Fehler.
--
--   H-4 (HIGH): LIMIT 1 ohne ORDER BY in agency_update_model_full und
--         agency_claim_unowned_model — nicht-deterministisch bei Multi-Org-Usern.
--         Fix: ORDER BY om.created_at ASC (älteste/erste Mitgliedschaft gewinnt).
--
-- Beide Funktionen werden vollständig neu definiert (CREATE OR REPLACE).
-- Keine Änderung an den Parametern oder der Autorisierungslogik.
-- Admin-Login-Pfad wird NICHT berührt.
-- =============================================================================

-- ─── 1. agency_update_model_full (H-4: ORDER BY) ─────────────────────────────

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
AS $$
DECLARE
  v_caller_agency_id uuid;
  v_model_agency_id  uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- H-4: ORDER BY om.created_at ASC — deterministisch bei Multi-Org-Membership
  SELECT org.agency_id INTO v_caller_agency_id
  FROM public.organization_members om
  JOIN public.organizations org ON org.id = om.organization_id
  WHERE om.user_id = auth.uid()
    AND org.agency_id IS NOT NULL
  ORDER BY om.created_at ASC
  LIMIT 1;

  -- Agency-Owner ohne organization_members Eintrag
  IF v_caller_agency_id IS NULL THEN
    SELECT a.id INTO v_caller_agency_id
    FROM public.agencies a
    WHERE a.owner_user_id = auth.uid()
    ORDER BY a.created_at ASC
    LIMIT 1;
  END IF;

  IF v_caller_agency_id IS NULL THEN
    RAISE EXCEPTION 'not_in_agency';
  END IF;

  SELECT agency_id INTO v_model_agency_id
  FROM public.models
  WHERE id = p_model_id;

  IF v_model_agency_id IS NOT NULL AND v_model_agency_id != v_caller_agency_id THEN
    RAISE EXCEPTION 'model_not_in_agency';
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
  'H-4 Security Audit 2026-04-05: ORDER BY om.created_at ASC für deterministische '
  'Agency-Auswahl bei Multi-Org-Membership. '
  'SECURITY DEFINER: Agency-Member dürfen alle Profildaten eines ihnen gehörenden '
  'Models oder eines noch nicht beanspruchten (agency_id IS NULL) Models aktualisieren.';


-- ─── 2. agency_claim_unowned_model (H-1: ROW_COUNT + H-4: ORDER BY) ──────────

CREATE OR REPLACE FUNCTION public.agency_claim_unowned_model(
  p_model_id                     uuid,
  p_agency_relationship_status   text    DEFAULT 'active',
  p_is_visible_fashion           boolean DEFAULT true,
  p_is_visible_commercial        boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_agency_id uuid;
  v_model_agency_id  uuid;
  v_row_count        integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- H-4: ORDER BY om.created_at ASC — deterministisch bei Multi-Org-Membership
  SELECT org.agency_id INTO v_caller_agency_id
  FROM public.organization_members om
  JOIN public.organizations org ON org.id = om.organization_id
  WHERE om.user_id = auth.uid()
    AND org.agency_id IS NOT NULL
  ORDER BY om.created_at ASC
  LIMIT 1;

  IF v_caller_agency_id IS NULL THEN
    SELECT a.id INTO v_caller_agency_id
    FROM public.agencies a
    WHERE a.owner_user_id = auth.uid()
    ORDER BY a.created_at ASC
    LIMIT 1;
  END IF;

  IF v_caller_agency_id IS NULL THEN
    RAISE EXCEPTION 'not_in_agency';
  END IF;

  -- Vorab-Check: Model muss frei sein (schneller Pfad, lesbar)
  SELECT agency_id INTO v_model_agency_id
  FROM public.models
  WHERE id = p_model_id;

  IF v_model_agency_id IS NOT NULL THEN
    RAISE EXCEPTION 'model_already_claimed';
  END IF;

  -- Atomares UPDATE mit doppeltem Guard (agency_id IS NULL in WHERE)
  UPDATE public.models SET
    agency_id                    = v_caller_agency_id,
    agency_relationship_status   = COALESCE(p_agency_relationship_status, 'active'),
    agency_relationship_ended_at = NULL,
    is_visible_fashion           = COALESCE(p_is_visible_fashion, true),
    is_visible_commercial        = COALESCE(p_is_visible_commercial, true)
  WHERE id = p_model_id
    AND agency_id IS NULL;

  -- H-1: ROW_COUNT-Check — RAISE wenn 0 Zeilen (Race Condition: anderer Caller
  -- hat agency_id zwischen Vorab-Check und UPDATE gesetzt)
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'model_already_claimed'
      USING HINT = 'Another agency claimed this model concurrently.';
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.agency_claim_unowned_model FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_claim_unowned_model TO authenticated;

COMMENT ON FUNCTION public.agency_claim_unowned_model IS
  'H-1/H-4 Security Audit 2026-04-05: ROW_COUNT-Check verhindert stilles No-Op '
  'bei Race Conditions. ORDER BY om.created_at ASC für deterministische Agency-Wahl. '
  'SECURITY DEFINER: Setzt agency_id für ein bisher nicht zugeordnetes Model.';


-- ─── Verifikation ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'agency_update_model_full'
  ), 'agency_update_model_full nicht gefunden';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'agency_claim_unowned_model'
  ), 'agency_claim_unowned_model nicht gefunden';

  RAISE NOTICE 'Migration 20260410_security_audit_agency_rpcs_fix: OK';
END $$;
