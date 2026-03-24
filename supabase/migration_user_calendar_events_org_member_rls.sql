-- =============================================================================
-- user_calendar_events: strict org-isolation RLS
-- Ensures:
--   1. Manual events are visible ONLY to the org that created them.
--   2. Agency members (bookers, owners) can access agency manual events.
--   3. Client events remain private to the individual user.
--   4. booking_events (separate table) are NOT affected here.
-- =============================================================================

-- Extend RLS: replace legacy email-only policy with org-member-aware policy.
-- Backward-compat: legacy email match is kept as a third branch so existing
-- agency-owner setups continue to work even before org records exist.

DROP POLICY IF EXISTS "Users can manage own calendar events" ON public.user_calendar_events;

CREATE POLICY "user_calendar_events_own"
  ON public.user_calendar_events FOR ALL
  TO authenticated
  USING (
    -- -----------------------------------------------------------------------
    -- CLIENT: private to the individual user who owns the event.
    -- No org-level sharing for client manual events (they are personal notes).
    -- -----------------------------------------------------------------------
    (owner_type = 'client' AND owner_id = auth.uid())

    -- -----------------------------------------------------------------------
    -- AGENCY: accessible to any member of the agency's organisation.
    -- Three access paths (first match wins):
    --   a) Modern: org_member row links user → organization → agency
    --   b) Modern: user is the organization owner of the agency's org
    --   c) Legacy: profile email matches agency email (backward compat)
    -- -----------------------------------------------------------------------
    OR (
      owner_type = 'agency'
      AND (
        -- (a) Org member
        EXISTS (
          SELECT 1
          FROM public.organization_members om
          JOIN public.organizations o ON o.id = om.organization_id
          WHERE om.user_id = auth.uid()
            AND o.agency_id = user_calendar_events.owner_id
        )
        -- (b) Org owner
        OR EXISTS (
          SELECT 1
          FROM public.organizations o
          WHERE o.owner_id = auth.uid()
            AND o.agency_id = user_calendar_events.owner_id
        )
        -- (c) Legacy email match (kept for backward compat)
        OR EXISTS (
          SELECT 1
          FROM public.agencies a
          JOIN public.profiles p ON p.id = auth.uid()
          WHERE p.role = 'agent'
            AND a.id = user_calendar_events.owner_id
            AND NULLIF(trim(lower(COALESCE(a.email, ''))), '') IS NOT NULL
            AND NULLIF(trim(lower(COALESCE(p.email, ''))), '') IS NOT NULL
            AND trim(lower(a.email)) = trim(lower(p.email))
        )
      )
    )
  )
  WITH CHECK (
    -- Identical to USING clause – no escalation possible.
    (owner_type = 'client' AND owner_id = auth.uid())
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
          JOIN public.profiles p ON p.id = auth.uid()
          WHERE p.role = 'agent'
            AND a.id = user_calendar_events.owner_id
            AND NULLIF(trim(lower(COALESCE(a.email, ''))), '') IS NOT NULL
            AND NULLIF(trim(lower(COALESCE(p.email, ''))), '') IS NOT NULL
            AND trim(lower(a.email)) = trim(lower(p.email))
        )
      )
    )
  );

-- =============================================================================
-- Invariant documentation (not executable – kept as DB comment for clarity):
--
-- MANUAL EVENTS  → user_calendar_events
--   Client events:  visible ONLY to auth.uid() == owner_id
--   Agency events:  visible ONLY to org members of the agency's organization
--   No model access. No cross-org access.
--
-- BOOKING EVENTS → booking_events  (unchanged, already correct)
--   Visible to: agency org members + client org members + model owner
--   See migration_system_hardening.sql for those policies.
-- =============================================================================
COMMENT ON TABLE public.user_calendar_events IS
  'Private manual calendar events per org. '
  'Client rows: private to the individual user (owner_id = auth.uid()). '
  'Agency rows: shared within the agency organisation (RLS via org membership). '
  'NOT the same as booking_events – these are personal/internal notes only.';
