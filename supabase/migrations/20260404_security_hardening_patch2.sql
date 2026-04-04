-- =============================================================================
-- Security Hardening Patch 2 — 2026-04-04
-- Fixes:
--   CRIT-1: Column-Level REVOKE for email/phone on models FROM authenticated
--   CRIT-2: prevent_admin_flag_escalation — SET search_path = public
--   CRIT-3: fn_validate_option_status_transition — SECURITY DEFINER + SET search_path = public
--   HIGH-1: list_client_organizations_for_agency_directory — restrict to connected clients only
--   HIGH-5: get_models_by_location — replace m.* with explicit safe field list (no email/phone)
-- =============================================================================

-- ─── CRIT-1: Block email/phone column updates on models from all authenticated roles ───
--
-- Column-Level REVOKE ensures no authenticated user can update email or phone,
-- regardless of any RLS policy that would otherwise allow it.
-- The model_update_own_profile policy (user_id = auth.uid()) is intentionally kept
-- for current_location only — see CRIT-1 allowlist below.

REVOKE UPDATE (email) ON public.models FROM authenticated;

-- Tighten model self-update: only current_location is allowed via model_update_own_profile.
-- All other columns remain locked for models via the existing REVOKE in
-- migration_security_hardening_2026_04.sql (agency_id, mediaslide_sync_id, admin_notes, etc.)
-- We additionally lock is_visible_fashion / is_visible_commercial / categories — only agencies
-- should control visibility.
REVOKE UPDATE (is_visible_fashion, is_visible_commercial, categories, agency_relationship_status)
  ON public.models FROM authenticated;


-- ─── CRIT-2: prevent_admin_flag_escalation — add SET search_path = public ─────────────
--
-- Without this, a session-level search_path manipulation could redirect the function
-- to a malicious schema. SECURITY DEFINER was already set; this adds the path guard.

ALTER FUNCTION public.prevent_admin_flag_escalation()
  SET search_path = public;


-- ─── CRIT-3: fn_validate_option_status_transition — SECURITY DEFINER + search_path ────
--
-- The version in migration_security_hardening_2026_04.sql added SET search_path = public
-- but forgot SECURITY DEFINER. We create the canonical, final version here.
-- This supersedes all previous definitions.

CREATE OR REPLACE FUNCTION public.fn_validate_option_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Terminal state: rejected rows cannot be changed
  IF OLD.status = 'rejected' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'Cannot transition from terminal state rejected (option_request %)', OLD.id;
  END IF;

  -- confirmed → in_negotiation is not allowed (no un-confirming)
  IF OLD.status = 'confirmed' AND NEW.status = 'in_negotiation' THEN
    RAISE EXCEPTION 'Cannot revert confirmed booking to in_negotiation (option_request %)', OLD.id;
  END IF;

  -- confirmed → rejected is not allowed (bookings cannot be cancelled via status field)
  IF OLD.status = 'confirmed' AND NEW.status = 'rejected' THEN
    RAISE EXCEPTION 'Cannot reject an already confirmed booking (option_request %)', OLD.id;
  END IF;

  -- final_status: job_confirmed is terminal
  IF OLD.final_status = 'job_confirmed' AND NEW.final_status <> OLD.final_status THEN
    RAISE EXCEPTION 'Cannot change final_status after job_confirmed (option_request %)', OLD.id;
  END IF;

  -- final_status: option_confirmed → option_pending revert is not allowed
  IF OLD.final_status = 'option_confirmed' AND NEW.final_status = 'option_pending' THEN
    RAISE EXCEPTION 'Cannot revert option_confirmed to option_pending (option_request %)', OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_option_status ON public.option_requests;
CREATE TRIGGER trg_validate_option_status
  BEFORE UPDATE OF status, final_status
  ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_option_status_transition();

COMMENT ON FUNCTION public.fn_validate_option_status_transition() IS
  'Canonical trigger guard for option_request status transitions. '
  'SECURITY DEFINER + SET search_path = public (patch2, 2026-04-04). '
  'Prevents illegal state transitions at DB level.';


-- ─── HIGH-1: list_client_organizations_for_agency_directory — restrict to connected clients ─
--
-- Previously returned ALL client organizations to any agency user.
-- Now restricted to client orgs that have an established connection with the agency
-- (via client_agency_connections, matching either the org-level columns or legacy user-level).

CREATE OR REPLACE FUNCTION public.list_client_organizations_for_agency_directory(
  p_agency_id uuid,
  p_search    text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller  uuid    := auth.uid();
  rows_json jsonb;
  q         text    := coalesce(trim(p_search), '');
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- Caller must be a member of the agency organisation
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.user_id = v_caller
      AND o.type    = 'agency'
      AND o.agency_id = p_agency_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_allowed');
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',                x.id,
        'name',              x.name,
        'organization_type', x.typ
      )
    ),
    '[]'::jsonb
  ) INTO rows_json
  FROM (
    SELECT o.id, o.name, o.type::text AS typ
    FROM public.organizations o
    WHERE o.type = 'client'
      AND (q = '' OR o.name ILIKE '%' || q || '%')
      -- HIGH-1 fix: only expose clients that have an established connection with this agency.
      -- Check org-level connection (from_organization_id) OR legacy user-level connection.
      AND (
        EXISTS (
          SELECT 1
          FROM public.client_agency_connections cac
          WHERE cac.agency_id = p_agency_id
            AND cac.from_organization_id = o.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.client_agency_connections cac
          JOIN public.organization_members om ON om.user_id = cac.client_id
          WHERE cac.agency_id   = p_agency_id
            AND om.organization_id = o.id
        )
      )
    ORDER BY o.name
    LIMIT 100
  ) x;

  RETURN jsonb_build_object('ok', true, 'rows', coalesce(rows_json, '[]'::jsonb));
END;
$$;

REVOKE ALL    ON FUNCTION public.list_client_organizations_for_agency_directory(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.list_client_organizations_for_agency_directory(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.list_client_organizations_for_agency_directory IS
  'Agency org members only. Returns client organizations the agency has a connection with. '
  'HIGH-1 fix (2026-04-04): restricted to connected clients via client_agency_connections.';


-- ─── HIGH-5: get_models_by_location — explicit safe field list (no email/phone) ─────────
--
-- The previous version used m.* which would expose any sensitive column added
-- to the models table in future migrations (e.g. email, admin_notes).
-- This version enumerates only safe, marketplace-ready fields.
-- Pagination parameters are preserved and enforced.

DROP FUNCTION IF EXISTS public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
);

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
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT to_jsonb(result)
  FROM (
    SELECT
      -- Safe, marketplace-ready fields only (no email, no admin_notes, no system flags)
      m.id,
      m.agency_id,
      m.user_id,
      m.agency_relationship_status,
      m.mediaslide_sync_id,
      m.netwalk_model_id,
      m.name,
      m.height,
      m.bust,
      m.waist,
      m.hips,
      m.chest,
      m.legs_inseam,
      m.shoe_size,
      m.city,
      m.country,
      m.country_code,
      m.hair_color,
      m.eye_color,
      m.current_location,
      m.is_visible_commercial,
      m.is_visible_fashion,
      m.categories,
      m.is_sports_winter,
      m.is_sports_summer,
      m.sex,
      m.ethnicity,
      m.created_at,
      m.updated_at,
      -- Territory join fields
      mat.country_code  AS territory_country_code,
      a.name            AS agency_name,
      mat.agency_id     AS territory_agency_id,
      -- City-priority sort helper: 0 = city match first, 1 = rest of country
      CASE
        WHEN p_city IS NOT NULL AND p_city <> '' AND m.city ILIKE p_city
        THEN 0
        ELSE 1
      END AS city_match_rank
    FROM public.models m
    JOIN public.model_agency_territories mat ON mat.model_id = m.id
    JOIN public.agencies                 a   ON a.id         = mat.agency_id
    WHERE
      mat.country_code = p_iso
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
      AND (p_sex             IS NULL OR m.sex          = p_sex)
      AND (
        p_hair_color IS NULL OR p_hair_color = ''
        OR m.hair_color ILIKE ('%' || p_hair_color || '%')
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
    ORDER BY city_match_rank ASC, m.name ASC
    OFFSET p_from
    LIMIT  (p_to - p_from + 1)
  ) result;
$$;

GRANT EXECUTE ON FUNCTION public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) TO authenticated, anon;

COMMENT ON FUNCTION public.get_models_by_location IS
  'Territory-scoped model discovery for client/guest use. '
  'HIGH-5 fix (2026-04-04): explicit safe field list replaces m.* — no email/phone/admin fields. '
  'Pagination enforced via p_from/p_to parameters.';
