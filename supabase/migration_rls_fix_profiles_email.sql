-- =============================================================================
-- DEPRECATED / DO NOT EXECUTE — DIAGNOSE ONLY (NOT DEPLOYED via supabase CLI)
--
-- This file lives outside `supabase/migrations/` and is NOT auto-deployed.
-- Canonical, deployed sources of truth live in `supabase/migrations/YYYYMMDD_*.sql`.
-- Manual execution can introduce silent regressions on the live DB
-- (RLS recursion, weakened SECURITY DEFINER guards, broken admin access, etc.).
--
-- See: `.cursor/rules/system-invariants.mdc` (LIVE-DB SOURCE OF TRUTH),
--      `docs/LIVE_DB_DRIFT_GUARDRAIL.md`,
--      `docs/CONSISTENCY_FLOW_CHECK_2026-04-19.md` (Cluster F).
--
-- If you need to apply changes, create a new dated migration in `supabase/migrations/`.
-- =============================================================================

-- =============================================================================
-- Security Fix: profiles.email – column-level privacy + RLS cleanup
--
-- Problem: "Profiles are readable by authenticated" has USING(true), meaning
--   every authenticated user (model, client, foreign booker) can SELECT all
--   columns including email and phone from any profile. DSGVO violation.
--
-- Root cause: Several legacy RLS policies in older migrations read p.email from
--   profiles (where p.id = auth.uid()) to match against agencies.email. Once we
--   revoke SELECT (email) at column level, those queries break.
--
-- Fix:
--   1. Create a SECURITY DEFINER helper get_current_user_email() that returns
--      the calling user's own email without requiring column-level privilege.
--   2. Recreate all active RLS policies that join profiles.email, replacing the
--      inline pattern with the helper function.
--   3. Revoke SELECT (email, phone) on profiles from the authenticated role.
--   4. Grant SELECT on the remaining public-safe columns.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STEP 1: SECURITY DEFINER helper – returns current user's email
--         Runs as postgres/owner, bypasses column-level restriction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_current_user_email()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email FROM public.profiles WHERE id = auth.uid();
$$;

REVOKE ALL  ON FUNCTION public.get_current_user_email() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_user_email() TO authenticated;

-- ---------------------------------------------------------------------------
-- STEP 2a: Recreate recruiting_chat_threads policies (from migration_system_hardening.sql)
--          Replacing JOIN profiles p / p.email with get_current_user_email().
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "recruiting_threads_select" ON public.recruiting_chat_threads;
CREATE POLICY "recruiting_threads_select"
  ON public.recruiting_chat_threads FOR SELECT
  TO authenticated
  USING (
    -- Agency org member
    (
      agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id = auth.uid()
          AND o.agency_id = recruiting_chat_threads.agency_id
      )
    )
    -- Legacy: profile email matches agency email
    OR (
      agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.agencies a
        WHERE a.id = recruiting_chat_threads.agency_id
          AND trim(lower(COALESCE(public.get_current_user_email(), ''))) != ''
          AND trim(lower(a.email)) = trim(lower(public.get_current_user_email()))
      )
    )
    -- The model applicant
    OR EXISTS (
      SELECT 1
      FROM public.model_applications app
      WHERE app.id = recruiting_chat_threads.application_id
        AND app.applicant_user_id = auth.uid()
    )
    -- Threads not yet assigned to an agency
    OR (agency_id IS NULL AND organization_id IS NULL AND created_by = auth.uid())
  );

DROP POLICY IF EXISTS "recruiting_threads_insert" ON public.recruiting_chat_threads;
CREATE POLICY "recruiting_threads_insert"
  ON public.recruiting_chat_threads FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id = auth.uid()
          AND o.agency_id = recruiting_chat_threads.agency_id
      )
    )
    OR (
      agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.agencies a
        WHERE a.id = recruiting_chat_threads.agency_id
          AND trim(lower(COALESCE(public.get_current_user_email(), ''))) != ''
          AND trim(lower(a.email)) = trim(lower(public.get_current_user_email()))
      )
    )
    OR agency_id IS NULL
  );

DROP POLICY IF EXISTS "recruiting_threads_update" ON public.recruiting_chat_threads;
CREATE POLICY "recruiting_threads_update"
  ON public.recruiting_chat_threads FOR UPDATE
  TO authenticated
  USING (
    (
      agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id = auth.uid()
          AND o.agency_id = recruiting_chat_threads.agency_id
      )
    )
    OR (
      agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.agencies a
        WHERE a.id = recruiting_chat_threads.agency_id
          AND trim(lower(COALESCE(public.get_current_user_email(), ''))) != ''
          AND trim(lower(a.email)) = trim(lower(public.get_current_user_email()))
      )
    )
  )
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- STEP 2b: Recreate recruiting_chat_messages policies (from migration_system_hardening.sql)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "recruiting_messages_select" ON public.recruiting_chat_messages;
CREATE POLICY "recruiting_messages_select"
  ON public.recruiting_chat_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.recruiting_chat_threads t
      WHERE t.id = recruiting_chat_messages.thread_id
        AND (
          (
            t.agency_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.organization_members om
              JOIN public.organizations o ON o.id = om.organization_id
              WHERE om.user_id = auth.uid()
                AND o.agency_id = t.agency_id
            )
          )
          OR (
            t.agency_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.agencies a
              WHERE a.id = t.agency_id
                AND trim(lower(COALESCE(public.get_current_user_email(), ''))) != ''
                AND trim(lower(a.email)) = trim(lower(public.get_current_user_email()))
            )
          )
          OR EXISTS (
            SELECT 1
            FROM public.model_applications app
            WHERE app.id = t.application_id
              AND app.applicant_user_id = auth.uid()
          )
          OR (t.agency_id IS NULL AND t.created_by = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "recruiting_messages_insert" ON public.recruiting_chat_messages;
CREATE POLICY "recruiting_messages_insert"
  ON public.recruiting_chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.recruiting_chat_threads t
      WHERE t.id = recruiting_chat_messages.thread_id
        AND (
          (
            t.agency_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.organization_members om
              JOIN public.organizations o ON o.id = om.organization_id
              WHERE om.user_id = auth.uid()
                AND o.agency_id = t.agency_id
            )
          )
          OR (
            t.agency_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.agencies a
              WHERE a.id = t.agency_id
                AND trim(lower(COALESCE(public.get_current_user_email(), ''))) != ''
                AND trim(lower(a.email)) = trim(lower(public.get_current_user_email()))
            )
          )
          OR EXISTS (
            SELECT 1
            FROM public.model_applications app
            WHERE app.id = t.application_id
              AND app.applicant_user_id = auth.uid()
          )
          OR (t.agency_id IS NULL AND t.created_by = auth.uid())
        )
    )
  );

-- ---------------------------------------------------------------------------
-- STEP 2c: Recreate user_calendar_events policy (from migration_org_calendar_booking_full_access.sql)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "user_calendar_events_org_shared" ON public.user_calendar_events;
CREATE POLICY "user_calendar_events_org_shared"
  ON public.user_calendar_events FOR ALL
  TO authenticated
  USING (
    -- Client: org-shared or personal
    (
      owner_type = 'client'
      AND (
        (
          organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organization_members om
            WHERE om.organization_id = user_calendar_events.organization_id
              AND om.user_id = auth.uid()
          )
        )
        OR (organization_id IS NULL AND owner_id = auth.uid())
        OR owner_id = auth.uid()
      )
    )
    -- Agency: org member or owner or legacy email match
    OR (
      owner_type = 'agency'
      AND (
        EXISTS (
          SELECT 1
          FROM public.organization_members om
          JOIN public.organizations o ON o.id = om.organization_id
          WHERE om.user_id = auth.uid()
            AND o.agency_id = user_calendar_events.owner_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.organizations o
          WHERE o.owner_id = auth.uid()
            AND o.agency_id = user_calendar_events.owner_id
        )
        -- Legacy fallback (backward compat for pre-org agency setups)
        OR EXISTS (
          SELECT 1
          FROM public.agencies a
          WHERE a.id = user_calendar_events.owner_id
            AND NULLIF(trim(lower(COALESCE(a.email, ''))), '') IS NOT NULL
            AND NULLIF(trim(lower(COALESCE(public.get_current_user_email(), ''))), '') IS NOT NULL
            AND trim(lower(a.email)) = trim(lower(public.get_current_user_email()))
            AND EXISTS (
              SELECT 1 FROM public.profiles pr
              WHERE pr.id = auth.uid() AND pr.role = 'agent'
            )
        )
      )
    )
  )
  WITH CHECK (
    (
      owner_type = 'client'
      AND (
        (
          organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organization_members om
            WHERE om.organization_id = user_calendar_events.organization_id
              AND om.user_id = auth.uid()
          )
        )
        OR (organization_id IS NULL AND owner_id = auth.uid())
        OR owner_id = auth.uid()
      )
    )
    OR (
      owner_type = 'agency'
      AND (
        EXISTS (
          SELECT 1
          FROM public.organization_members om
          JOIN public.organizations o ON o.id = om.organization_id
          WHERE om.user_id = auth.uid()
            AND o.agency_id = user_calendar_events.owner_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.organizations o
          WHERE o.owner_id = auth.uid()
            AND o.agency_id = user_calendar_events.owner_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.agencies a
          WHERE a.id = user_calendar_events.owner_id
            AND NULLIF(trim(lower(COALESCE(a.email, ''))), '') IS NOT NULL
            AND NULLIF(trim(lower(COALESCE(public.get_current_user_email(), ''))), '') IS NOT NULL
            AND trim(lower(a.email)) = trim(lower(public.get_current_user_email()))
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- STEP 3: Column-level security on profiles
--   REVOKE email + phone from the authenticated role.
--   GRANT only the non-sensitive columns.
--   Admin access to full profile data goes through admin_get_profiles() RPC.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Profiles are readable by authenticated" ON public.profiles;

-- All authenticated users may SELECT non-sensitive profile fields.
-- email + phone are revoked at column level (see below).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_select_authenticated'
  ) THEN
    CREATE POLICY "profiles_select_authenticated"
      ON public.profiles FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;

-- Revoke sensitive columns from the authenticated Postgres role.
-- Any query that names (email) or (phone) as a SELECT column will be rejected
-- unless it runs inside a SECURITY DEFINER function.
REVOKE SELECT (email, phone) ON public.profiles FROM authenticated;

-- Grant the non-sensitive columns explicitly.
GRANT SELECT (
  id,
  display_name,
  role,
  company_name,
  website,
  social_links,
  avatar_url,
  country,
  created_at,
  updated_at
) ON public.profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- STEP 4: Admin RPC – returns full profile rows (incl. email/phone)
--   Only callable when the current user has is_admin = true.
--   The frontend replaces the direct supabase.from('profiles').select(email...)
--   call with this RPC in the admin panel.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_profiles(
  p_active_only   boolean DEFAULT NULL,
  p_inactive_only boolean DEFAULT NULL,
  p_role          text    DEFAULT NULL
)
RETURNS SETOF public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (SELECT COALESCE(is_admin, false) FROM public.profiles WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.profiles p
  WHERE (p_active_only  IS NULL OR p.is_active = p_active_only)
    AND (p_inactive_only IS NULL OR p.is_active = NOT p_inactive_only)
    AND (p_role IS NULL OR p.role::text = p_role)
  ORDER BY p.created_at DESC;
END;
$$;

REVOKE ALL  ON FUNCTION public.admin_get_profiles(boolean, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_profiles(boolean, boolean, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- STEP 5: Org member email lookup RPC
--   Returns email addresses of members in the caller's organization.
--   Requires the caller to be an owner/booker/employee of that org.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_org_member_emails(p_org_id UUID)
RETURNS TABLE (user_id UUID, display_name TEXT, email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = p_org_id AND om.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT om.user_id, p.display_name, p.email
  FROM public.organization_members om
  JOIN public.profiles p ON p.id = om.user_id
  WHERE om.organization_id = p_org_id;
END;
$$;

REVOKE ALL  ON FUNCTION public.get_org_member_emails(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_member_emails(UUID) TO authenticated;
