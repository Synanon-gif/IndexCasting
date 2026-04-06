-- =============================================================================
-- Definitive: agency_update_model_full + agency_claim_unowned_model
-- Date: 2026-04-12
--
-- WHY THIS EXISTS:
--   Previous migrations applied these functions in conflicting order:
--   - 20260409_model_agency_permission_fix.sql      → original (no row_security, no ORDER BY)
--   - 20260410_security_audit_agency_rpcs_fix.sql   → H-4 ORDER BY + H-1 ROW_COUNT (no row_security)
--   - 20260406_security_definer_row_security_fix.sql → SET row_security TO off (no ORDER BY)
--
--   Result: whichever ran last wins. This migration is the single authoritative
--   definition combining ALL fixes. Must be applied LAST (date 20260412 > others).
--
-- COMBINES:
--   1. SET row_security TO off       — mandatory for SECURITY DEFINER that reads
--                                      RLS-protected tables (PG15+ latent recursion)
--   2. H-4 ORDER BY om.created_at   — deterministic org selection for multi-org users
--   3. H-1 GET DIAGNOSTICS ROW_COUNT — detect & raise on race condition in claim
--   4. Explicit internal auth guards — every SECURITY DEFINER + row_security=off
--                                      MUST have an explicit internal authorization
--                                      check that does not rely on RLS.
--
-- SECURITY MODEL (mandatory for SET row_security TO off functions):
--   - auth.uid() IS NULL → RAISE immediately (unauthenticated)
--   - Caller's agency is resolved from organization_members/agencies (not from RLS)
--   - Model ownership/availability is verified explicitly before any mutation
--   - No RLS policy can substitute for these internal checks
--
-- Idempotent: CREATE OR REPLACE.
-- =============================================================================


-- ─── 1. agency_update_model_full ─────────────────────────────────────────────

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
SET row_security TO off   -- RLS bypassed; internal guards below are the sole auth layer
AS $$
DECLARE
  v_caller_agency_id uuid;
  v_model_agency_id  uuid;
BEGIN
  -- INTERNAL GUARD 1: Must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- INTERNAL GUARD 2: Caller must belong to an agency org
  -- ORDER BY created_at ASC: deterministic for multi-org membership (H-4)
  SELECT org.agency_id INTO v_caller_agency_id
  FROM public.organization_members om
  JOIN public.organizations org ON org.id = om.organization_id
  WHERE om.user_id = auth.uid()
    AND org.agency_id IS NOT NULL
  ORDER BY om.created_at ASC
  LIMIT 1;

  -- Fallback: agency owners may not have an organization_members row
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

  -- INTERNAL GUARD 3: Model must belong to caller's agency (or have no agency yet)
  SELECT agency_id INTO v_model_agency_id
  FROM public.models
  WHERE id = p_model_id;

  IF v_model_agency_id IS NOT NULL AND v_model_agency_id != v_caller_agency_id THEN
    RAISE EXCEPTION 'model_not_in_agency';
  END IF;

  -- Authorized: perform the update
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
    -- Empty array {} = explicit NULL (delete categories); NULL = no change
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
  'DEFINITIVE (20260412): row_security=off + H-4 ORDER BY + internal auth guards. '
  'Agency-Member may update all profile data of a model belonging to their agency '
  'or of a model not yet claimed (agency_id IS NULL). Sync-IDs via update_model_sync_ids RPC.';


-- ─── 2. agency_claim_unowned_model ───────────────────────────────────────────

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
SET row_security TO off   -- RLS bypassed; internal guards below are the sole auth layer
AS $$
DECLARE
  v_caller_agency_id uuid;
  v_model_agency_id  uuid;
  v_row_count        integer;
BEGIN
  -- INTERNAL GUARD 1: Must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- INTERNAL GUARD 2: Caller must belong to an agency org
  -- ORDER BY created_at ASC: deterministic for multi-org membership (H-4)
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

  -- INTERNAL GUARD 3: Pre-check — model must be unclaimed (fast path)
  SELECT agency_id INTO v_model_agency_id
  FROM public.models
  WHERE id = p_model_id;

  IF v_model_agency_id IS NOT NULL THEN
    RAISE EXCEPTION 'model_already_claimed';
  END IF;

  -- INTERNAL GUARD 4: Atomic UPDATE with double guard (race condition protection, H-1)
  -- The WHERE agency_id IS NULL prevents a race where two callers pass the pre-check
  -- simultaneously: only one UPDATE will find agency_id still NULL.
  UPDATE public.models SET
    agency_id                    = v_caller_agency_id,
    agency_relationship_status   = COALESCE(p_agency_relationship_status, 'active'),
    agency_relationship_ended_at = NULL,
    is_visible_fashion           = COALESCE(p_is_visible_fashion, true),
    is_visible_commercial        = COALESCE(p_is_visible_commercial, true)
  WHERE id = p_model_id
    AND agency_id IS NULL;

  -- H-1: If ROW_COUNT = 0 another agency claimed the model concurrently (raise)
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
  'DEFINITIVE (20260412): row_security=off + H-4 ORDER BY + H-1 ROW_COUNT + internal auth guards. '
  'Claims an unclaimed model (agency_id IS NULL) for the caller''s agency. '
  'Race condition safe: atomic UPDATE with double guard + ROW_COUNT check.';


-- ─── Verification ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_conf text[];
BEGIN
  -- agency_update_model_full: must have row_security=off
  SELECT proconfig INTO v_conf FROM pg_proc WHERE proname = 'agency_update_model_full' LIMIT 1;
  ASSERT 'row_security=off' = ANY(v_conf),
    'FAIL: agency_update_model_full missing row_security=off';

  -- agency_claim_unowned_model: must have row_security=off
  SELECT proconfig INTO v_conf FROM pg_proc WHERE proname = 'agency_claim_unowned_model' LIMIT 1;
  ASSERT 'row_security=off' = ANY(v_conf),
    'FAIL: agency_claim_unowned_model missing row_security=off';

  -- Source must contain ORDER BY (verify H-4 is present)
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'agency_update_model_full'
      AND prosrc ILIKE '%ORDER BY om.created_at%'
  ), 'FAIL: agency_update_model_full missing ORDER BY om.created_at';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'agency_claim_unowned_model'
      AND prosrc ILIKE '%GET DIAGNOSTICS%'
  ), 'FAIL: agency_claim_unowned_model missing GET DIAGNOSTICS (H-1)';

  RAISE NOTICE 'PASS: 20260412_agency_rpcs_definitive — all verifications passed';
END $$;
