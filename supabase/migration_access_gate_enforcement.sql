-- =============================================================================
-- Access Gate Enforcement — 2026-04 Security Hardening
--
-- Closes the backend paywall bypass identified in the 2026-04 audit:
--
--   BYPASS-01 (CRITICAL): get_models_by_location() is SECURITY INVOKER with
--     no can_access_platform() call. Any authenticated user (expired trial,
--     cancelled subscription) can discover models by calling the RPC directly.
--     Fix: add access gate check at the top of the function for authenticated
--     callers. Anon callers (guest-link viewers) are exempt because they have
--     no organisation membership and use the scoped get_guest_link_models() RPC.
--
--   BYPASS-02 (CRITICAL): option_requests INSERT RLS policy
--     option_requests_insert_client does NOT check platform access. A direct
--     PostgREST API call with a valid but expired-subscription JWT can insert
--     option requests.
--     Fix: add has_platform_access() to the WITH CHECK clause.
--
--   BYPASS-03 (CRITICAL): messages INSERT RLS policy messages_insert_sender
--     does NOT check platform access. A direct API call can send messages
--     without a valid subscription.
--     Fix: add has_platform_access() to the WITH CHECK clause.
--
-- New helper:
--   has_platform_access() BOOLEAN — thin STABLE SECURITY DEFINER wrapper
--   around can_access_platform(). Being STABLE means Postgres evaluates it
--   once per statement (not once per row), so the cost is a single lookup
--   per INSERT, not N lookups per batch.
--
-- Run AFTER migration_hardening_2026_04_final.sql.
-- Idempotent: CREATE OR REPLACE / DROP IF EXISTS guards throughout.
-- =============================================================================


-- ─── 1. Boolean helper: has_platform_access() ─────────────────────────────

CREATE OR REPLACE FUNCTION public.has_platform_access()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE(
    ((public.can_access_platform()) ->> 'allowed')::BOOLEAN,
    false
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.has_platform_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_platform_access() TO authenticated;

COMMENT ON FUNCTION public.has_platform_access() IS
  'Boolean shorthand for can_access_platform(). STABLE so Postgres evaluates '
  'it once per statement when used inside RLS policies, not once per row. '
  'BYPASS-01/02/03 fix (2026-04 audit).';


-- ─── 2. BYPASS-02: Tighten option_requests INSERT policy ──────────────────
--
-- The previous policy (migration_rls_fix_option_requests_safety.sql) only
-- verified org membership. We now also require a valid platform subscription.

DROP POLICY IF EXISTS "option_requests_insert_client" ON public.option_requests;

CREATE POLICY option_requests_insert_client
  ON public.option_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    client_id = auth.uid()
    AND public.has_platform_access()
    AND (
      organization_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.organization_members m
        WHERE m.organization_id = option_requests.organization_id
          AND m.user_id = auth.uid()
      )
    )
  );

COMMENT ON POLICY option_requests_insert_client ON public.option_requests IS
  'Clients may create option requests only if they belong to the org AND have '
  'an active subscription / trial / admin override. BYPASS-02 fix 2026-04.';


-- ─── 3. BYPASS-03: Tighten messages INSERT policy ─────────────────────────
--
-- Drop the existing policy (defined in migration_connection_messenger_org_scope.sql)
-- and recreate with the additional has_platform_access() guard.

DROP POLICY IF EXISTS "messages_insert_sender" ON public.messages;

CREATE POLICY "messages_insert_sender"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.conversation_accessible_to_me(conversation_id)
    AND public.has_platform_access()
  );

COMMENT ON POLICY "messages_insert_sender" ON public.messages IS
  'Senders may insert messages only into accessible conversations AND when '
  'the platform is accessible (active subscription / trial / override). '
  'BYPASS-03 fix 2026-04.';


-- ─── 4. BYPASS-01: Add access gate to get_models_by_location() ────────────
--
-- Drop old function signatures before redefining (language change sql→plpgsql
-- requires DROP because return type / language are part of the function
-- signature in some Postgres versions).
DROP FUNCTION IF EXISTS public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text
);
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
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Enforce paywall for authenticated users only.
  -- Anon callers are guest-link viewers who use the separate scoped RPC
  -- get_guest_link_models() — they have no organisation and must not be
  -- blocked here (they also cannot call this RPC in practice since the
  -- client SDK always calls get_guest_link_models for guest flows).
  IF auth.role() = 'authenticated' THEN
    IF NOT public.has_platform_access() THEN
      RAISE EXCEPTION 'platform_access_denied'
        USING HINT = 'Active subscription or trial required to discover models.',
              ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN QUERY
  SELECT to_jsonb(result)
  FROM (
    SELECT
      m.*,
      mat.country_code  AS territory_country_code,
      a.name            AS agency_name,
      mat.agency_id     AS territory_agency_id
    FROM public.models m
    JOIN public.model_agency_territories mat ON mat.model_id   = m.id
    JOIN public.agencies                 a   ON a.id           = mat.agency_id
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

GRANT EXECUTE ON FUNCTION public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) TO authenticated, anon;

COMMENT ON FUNCTION public.get_models_by_location(
  text, text, integer, integer, text, text, boolean, boolean,
  integer, integer, text, integer, integer, integer, integer,
  integer, integer, integer, integer, text, text[]
) IS
  'Territory-based model discovery. Authenticated callers must have an active '
  'subscription / trial / admin override (BYPASS-01 fix 2026-04). '
  'Anon callers (guest-link viewers) are exempt — they use get_guest_link_models().';
