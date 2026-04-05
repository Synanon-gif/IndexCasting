-- =============================================================================
-- Migration: 20260409_model_agency_permission_fix.sql
--
-- Ziel:
--   1. agency_update_model_full       — SECURITY DEFINER RPC für vollständige
--                                       Agency-Kontrolle über Modelldaten
--   2. agency_claim_unowned_model     — SECURITY DEFINER RPC zum Beanspruchen
--                                       eines noch nicht zugeordneten Models
--   3. model_update_own_profile_safe  — SECURITY DEFINER RPC für Model-Selbst-
--                                       Update (nur wenn kein Agency zugeordnet)
--   4. admin_update_model_minor_flag  — SECURITY DEFINER RPC für Admin-only
--                                       Minderjährigen-Flag
--   5. one_admin_only                 — Partieller Unique-Index: nur genau ein
--                                       Profil mit role = 'admin'
--
-- Warum RPCs statt direkter Updates:
--   REVOKE UPDATE ... FROM authenticated in migration_security_hardening_2026_04.sql
--   sperrt direkte Client-Updates auf models (inkl. sensibler Spalten).
--   SECURITY DEFINER Funktionen laufen als Ersteller (postgres) und umgehen
--   den REVOKE — mit expliziter Autorisierungsprüfung stattdessen.
-- =============================================================================

-- ─── 1. agency_update_model_full ─────────────────────────────────────────────
--
-- Erlaubt Agency-Membern alle Profildaten eines ihnen gehörenden Models zu
-- aktualisieren. Auch für Modelle ohne Agency (agency_id IS NULL) erlaubt,
-- damit Import-/Sync-Flows vor dem Claim-Schritt Daten setzen können.
--
-- NULL-Semantik: NULL = keine Änderung (COALESCE).
-- Ausnahme: p_categories — leeres Array {} = Feld auf NULL setzen.
-- Sync-IDs (mediaslide_sync_id, netwalk_model_id) → update_model_sync_ids RPC.

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

  -- Caller muss Agency-Member sein
  SELECT org.agency_id INTO v_caller_agency_id
  FROM public.organization_members om
  JOIN public.organizations org ON org.id = om.organization_id
  WHERE om.user_id = auth.uid()
    AND org.agency_id IS NOT NULL
  LIMIT 1;

  -- Auch Agency-Owner ohne organization_members Eintrag prüfen
  IF v_caller_agency_id IS NULL THEN
    SELECT a.id INTO v_caller_agency_id
    FROM public.agencies a
    WHERE a.owner_user_id = auth.uid()
    LIMIT 1;
  END IF;

  IF v_caller_agency_id IS NULL THEN
    RAISE EXCEPTION 'not_in_agency';
  END IF;

  -- Model's aktuelle Agency auflösen
  SELECT agency_id INTO v_model_agency_id
  FROM public.models
  WHERE id = p_model_id;

  -- Erlaubt wenn: Model gehört dieser Agency ODER Model hat noch keine Agency
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
    -- Leeres Array {} = explizites NULL (Kategorien löschen); NULL = keine Änderung
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
  'SECURITY DEFINER: Agency-Member dürfen alle Profildaten eines ihnen '
  'gehörenden Models oder eines noch nicht beanspruchten (agency_id IS NULL) '
  'Models aktualisieren. Sync-IDs via update_model_sync_ids RPC.';


-- ─── 2. agency_claim_unowned_model ───────────────────────────────────────────
--
-- Beansprucht ein Model ohne Agency: setzt agency_id auf die des Callers
-- und initialisiert Relationship-Felder. Nur ausführbar wenn agency_id IS NULL.

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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Caller muss Agency-Member sein
  SELECT org.agency_id INTO v_caller_agency_id
  FROM public.organization_members om
  JOIN public.organizations org ON org.id = om.organization_id
  WHERE om.user_id = auth.uid()
    AND org.agency_id IS NOT NULL
  LIMIT 1;

  IF v_caller_agency_id IS NULL THEN
    SELECT a.id INTO v_caller_agency_id
    FROM public.agencies a
    WHERE a.owner_user_id = auth.uid()
    LIMIT 1;
  END IF;

  IF v_caller_agency_id IS NULL THEN
    RAISE EXCEPTION 'not_in_agency';
  END IF;

  -- Model muss keine Agency haben
  SELECT agency_id INTO v_model_agency_id
  FROM public.models
  WHERE id = p_model_id;

  IF v_model_agency_id IS NOT NULL THEN
    RAISE EXCEPTION 'model_already_claimed';
  END IF;

  UPDATE public.models SET
    agency_id                    = v_caller_agency_id,
    agency_relationship_status   = COALESCE(p_agency_relationship_status, 'active'),
    agency_relationship_ended_at = NULL,
    is_visible_fashion           = COALESCE(p_is_visible_fashion, true),
    is_visible_commercial        = COALESCE(p_is_visible_commercial, true)
  WHERE id = p_model_id
    AND agency_id IS NULL;  -- Doppelter Guard gegen Race Conditions
END;
$$;

REVOKE ALL    ON FUNCTION public.agency_claim_unowned_model FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_claim_unowned_model TO authenticated;

COMMENT ON FUNCTION public.agency_claim_unowned_model IS
  'SECURITY DEFINER: Setzt agency_id für ein bisher nicht zugeordnetes Model. '
  'Nur ausführbar wenn models.agency_id IS NULL.';


-- ─── 3. model_update_own_profile_safe ────────────────────────────────────────
--
-- Models können ihr eigenes Profil aktualisieren — aber NUR wenn sie keiner
-- Agency zugeordnet sind. Agency-controlled Models sind komplett gesperrt.

CREATE OR REPLACE FUNCTION public.model_update_own_profile_safe(
  p_city             text DEFAULT NULL,
  p_country          text DEFAULT NULL,
  p_current_location text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.models
    WHERE user_id = auth.uid()
      AND agency_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'forbidden: agency_controls_profile';
  END IF;

  UPDATE public.models SET
    city             = COALESCE(p_city,             city),
    country          = COALESCE(p_country,          country),
    current_location = COALESCE(p_current_location, current_location)
  WHERE user_id = auth.uid();
END;
$$;

REVOKE ALL    ON FUNCTION public.model_update_own_profile_safe FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.model_update_own_profile_safe TO authenticated;

COMMENT ON FUNCTION public.model_update_own_profile_safe IS
  'SECURITY DEFINER: Models dürfen ihr eigenes Profil nur aktualisieren wenn '
  'sie keiner Agency zugeordnet sind (agency_id IS NULL).';


-- ─── 4. admin_update_model_minor_flag ────────────────────────────────────────
--
-- Setzt models.is_minor = true. Nur für den Platform-Admin ausführbar.
-- Prüft über assert_is_admin() (UUID + Email gepinnt).

CREATE OR REPLACE FUNCTION public.admin_update_model_minor_flag(
  p_model_id uuid,
  p_is_minor boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_is_admin();

  UPDATE public.models SET
    is_minor = COALESCE(p_is_minor, is_minor)
  WHERE id = p_model_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_update_model_minor_flag FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_model_minor_flag TO authenticated;

COMMENT ON FUNCTION public.admin_update_model_minor_flag IS
  'SECURITY DEFINER Admin-Only: Setzt das Minderjährigen-Flag auf einem Model. '
  'Benötigt Platform-Admin UUID + Email Pin via assert_is_admin().';


-- ─── 5. one_admin_only — Partieller Unique-Index ─────────────────────────────
--
-- Stellt sicher dass genau ein Profil mit role = 'admin' existieren kann.
-- Ergänzt den bestehenden Trigger-Schutz als zusätzliche DB-Layer-Garantie.

CREATE UNIQUE INDEX IF NOT EXISTS one_admin_only
  ON public.profiles ((role))
  WHERE role = 'admin';

COMMENT ON INDEX public.one_admin_only IS
  'Partieller Unique-Index: garantiert DB-seitig dass maximal ein Profil '
  'role=admin haben kann. Ergänzt BEFORE UPDATE Trigger und UUID/Email-Pin.';


-- ─── Verifikation ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'agency_update_model_full'
  ), 'agency_update_model_full not found';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'agency_claim_unowned_model'
  ), 'agency_claim_unowned_model not found';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'model_update_own_profile_safe'
  ), 'model_update_own_profile_safe not found';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'admin_update_model_minor_flag'
  ), 'admin_update_model_minor_flag not found';

  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'one_admin_only'
  ), 'one_admin_only index not found';

  RAISE NOTICE 'Migration 20260409_model_agency_permission_fix: alle Objekte OK';
END $$;
