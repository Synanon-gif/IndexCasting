-- =============================================================================
-- Security Audit Fix: user_calendar_events — Email-Matching in RLS (DANGER 2)
-- Date: 2026-04-06
--
-- PROBLEM:
--   The single FOR ALL policy "user_calendar_events_org_shared" contains a
--   branch that grants agency access via:
--     JOIN profiles p ON p.id = auth.uid()
--     WHERE p.role = 'agent'
--       AND TRIM(lower(a.email)) = TRIM(lower(p.email))
--
--   This is DANGER 2: email-based access control is unsafe because:
--   1. Email can change (profile.email vs agencies.email may diverge)
--   2. Email collision across accounts → potential data leak
--   3. Bypasses org-membership model (role='agent' is a profile role, not an
--      organization_members role — legacy concept that predates multi-tenant orgs)
--
--   Additionally, a single FOR ALL policy on a table that could be in the
--   profiles/models SELECT path is a recursion risk (RULE 7).
--
-- FIX:
--   1. Drop the FOR ALL policy.
--   2. Recreate as separate SELECT + INSERT + UPDATE + DELETE policies.
--   3. Remove the email-matching branch entirely — the org-membership branches
--      already cover all legitimate agency users (org member or org owner).
--
-- The two surviving agency branches are:
--   a) EXISTS (om JOIN organizations WHERE om.user_id=auth.uid() AND o.agency_id=owner_id)
--   b) EXISTS (organizations WHERE o.owner_id=auth.uid() AND o.agency_id=owner_id)
-- These cover every booker and agency owner via the standard multi-tenant model.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
-- =============================================================================

DROP POLICY IF EXISTS "user_calendar_events_org_shared" ON public.user_calendar_events;


-- ─── SELECT ──────────────────────────────────────────────────────────────────

CREATE POLICY "user_calendar_events_select"
  ON public.user_calendar_events
  FOR SELECT
  TO authenticated
  USING (
    -- Admin override
    public.is_current_user_admin()
    OR
    -- Client org member
    (
      owner_type = 'client'
      AND (
        (
          organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = user_calendar_events.organization_id
              AND om.user_id = auth.uid()
          )
        )
        OR owner_id = auth.uid()
      )
    )
    OR
    -- Agency org member or org owner (no email matching)
    (
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
          SELECT 1 FROM public.organizations o
          WHERE o.owner_id = auth.uid()
            AND o.agency_id = user_calendar_events.owner_id
        )
      )
    )
  );


-- ─── INSERT ──────────────────────────────────────────────────────────────────

CREATE POLICY "user_calendar_events_insert"
  ON public.user_calendar_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_current_user_admin()
    OR
    (
      owner_type = 'client'
      AND (
        (
          organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = user_calendar_events.organization_id
              AND om.user_id = auth.uid()
          )
        )
        OR owner_id = auth.uid()
      )
    )
    OR
    (
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
          SELECT 1 FROM public.organizations o
          WHERE o.owner_id = auth.uid()
            AND o.agency_id = user_calendar_events.owner_id
        )
      )
    )
  );


-- ─── UPDATE ──────────────────────────────────────────────────────────────────

CREATE POLICY "user_calendar_events_update"
  ON public.user_calendar_events
  FOR UPDATE
  TO authenticated
  USING (
    public.is_current_user_admin()
    OR
    (
      owner_type = 'client'
      AND (
        (
          organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = user_calendar_events.organization_id
              AND om.user_id = auth.uid()
          )
        )
        OR owner_id = auth.uid()
      )
    )
    OR
    (
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
          SELECT 1 FROM public.organizations o
          WHERE o.owner_id = auth.uid()
            AND o.agency_id = user_calendar_events.owner_id
        )
      )
    )
  )
  WITH CHECK (
    public.is_current_user_admin()
    OR
    (
      owner_type = 'client'
      AND (
        (
          organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = user_calendar_events.organization_id
              AND om.user_id = auth.uid()
          )
        )
        OR owner_id = auth.uid()
      )
    )
    OR
    (
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
          SELECT 1 FROM public.organizations o
          WHERE o.owner_id = auth.uid()
            AND o.agency_id = user_calendar_events.owner_id
        )
      )
    )
  );


-- ─── DELETE ──────────────────────────────────────────────────────────────────

CREATE POLICY "user_calendar_events_delete"
  ON public.user_calendar_events
  FOR DELETE
  TO authenticated
  USING (
    public.is_current_user_admin()
    OR
    (
      owner_type = 'client'
      AND (
        (
          organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id = user_calendar_events.organization_id
              AND om.user_id = auth.uid()
          )
        )
        OR owner_id = auth.uid()
      )
    )
    OR
    (
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
          SELECT 1 FROM public.organizations o
          WHERE o.owner_id = auth.uid()
            AND o.agency_id = user_calendar_events.owner_id
        )
      )
    )
  );


-- ─── Verification ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- No email matching remaining
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_calendar_events'
      AND qual ILIKE '%a.email%'
  ), 'FAIL: user_calendar_events still has email-matching policy';

  -- FOR ALL policy is gone
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_calendar_events'
      AND cmd = 'ALL'
  ), 'FAIL: user_calendar_events still has FOR ALL policy';

  -- All four separate policies exist
  ASSERT (
    SELECT COUNT(*) FROM pg_policies
    WHERE tablename = 'user_calendar_events'
      AND policyname IN (
        'user_calendar_events_select',
        'user_calendar_events_insert',
        'user_calendar_events_update',
        'user_calendar_events_delete'
      )
  ) = 4, 'FAIL: expected 4 split policies on user_calendar_events';

  RAISE NOTICE 'PASS: user_calendar_events — email-matching removed, FOR ALL split into 4 policies';
END $$;
