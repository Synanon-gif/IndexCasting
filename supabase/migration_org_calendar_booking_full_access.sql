-- =============================================================================
-- Org-wide Calendar & Booking Access
--
-- Changes:
--  1. user_calendar_events RLS – client events are now shared org-wide:
--       any member of the same client organisation can read, create, update
--       and delete calendar events tagged with that organisation_id.
--  2. option_request_visible_to_me() – Bookers of an agency org see ALL
--       option requests for that agency (assignee-lock removed).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. user_calendar_events – replace all existing policies with a single
--    org-aware policy.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can manage own calendar events" ON public.user_calendar_events;
DROP POLICY IF EXISTS "user_calendar_events_own"             ON public.user_calendar_events;
DROP POLICY IF EXISTS "user_calendar_events_org_shared"      ON public.user_calendar_events;

CREATE POLICY "user_calendar_events_org_shared"
  ON public.user_calendar_events FOR ALL
  TO authenticated
  USING (
    -- -----------------------------------------------------------------------
    -- CLIENT: visible to all members of the same client organisation.
    --   Path (a) – modern: organisation_id is set and the current user is a
    --              member of that organisation.
    --   Path (b) – legacy: organisation_id is NULL and owner_id = auth.uid()
    --              (events created before the org migration still work).
    -- -----------------------------------------------------------------------
    (
      owner_type = 'client'
      AND (
        -- (a) Modern org-member access
        (
          organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organization_members om
            WHERE om.organization_id = user_calendar_events.organization_id
              AND om.user_id = auth.uid()
          )
        )
        -- (b) Legacy personal event (no org tag)
        OR (
          organization_id IS NULL
          AND owner_id = auth.uid()
        )
        -- (c) Always let the direct owner see their own events regardless of org
        OR owner_id = auth.uid()
      )
    )

    -- -----------------------------------------------------------------------
    -- AGENCY: accessible to any member of the agency's organisation.
    --   Path (a) – modern org_member row links user → organisation → agency.
    --   Path (b) – modern: user is the organisation owner.
    --   Path (c) – legacy email match (backward compat).
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
        -- (c) Legacy email match
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
    -- -----------------------------------------------------------------------
    -- CLIENT: org members may insert/update events for their organisation.
    --   The inserting user must be a member of the given organisation_id
    --   OR be the direct owner (owner_id = auth.uid()).
    -- -----------------------------------------------------------------------
    (
      owner_type = 'client'
      AND (
        -- Modern: org member inserting/updating
        (
          organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organization_members om
            WHERE om.organization_id = user_calendar_events.organization_id
              AND om.user_id = auth.uid()
          )
        )
        -- Legacy / personal
        OR (
          organization_id IS NULL
          AND owner_id = auth.uid()
        )
        -- Direct owner always allowed
        OR owner_id = auth.uid()
      )
    )
    -- Agency write: same three paths as USING
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

COMMENT ON TABLE public.user_calendar_events IS
  'Manual calendar events per party. '
  'Client events: shared within the client organisation (RLS via org membership); '
  'legacy rows without organisation_id remain private to the creating user. '
  'Agency events: shared within the agency organisation (RLS via org membership). '
  'NOT the same as booking_events – these are personal/internal notes.';


-- -----------------------------------------------------------------------------
-- 2. option_request_visible_to_me() – remove the agency_assignee_user_id
--    guard for bookers so every booker in an agency org sees all requests
--    for that agency (same as owner).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.option_request_visible_to_me(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.option_requests oq
    WHERE oq.id = p_request_id
      AND (
        -- Model owner
        EXISTS (
          SELECT 1 FROM public.models mo
          WHERE mo.id = oq.model_id AND mo.user_id = auth.uid()
        )

        -- Client: modern org-member access
        OR (
          oq.organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organizations oc
            JOIN public.organization_members mc ON mc.organization_id = oc.id
            WHERE oc.id = oq.organization_id
              AND oc.type = 'client'
              AND mc.user_id = auth.uid()
          )
        )

        -- Client: legacy (no org tag yet)
        OR (
          oq.organization_id IS NULL
          AND oq.client_id = auth.uid()
        )

        -- Agency: owner OR booker – all see all requests for the agency.
        -- The agency_assignee_user_id is kept for operational tracking but no
        -- longer gates visibility; any booker can pick up any open request.
        OR EXISTS (
          SELECT 1
          FROM public.organizations oa
          JOIN public.organization_members ma ON ma.organization_id = oa.id
          WHERE oa.agency_id = oq.agency_id
            AND oa.type = 'agency'
            AND ma.user_id = auth.uid()
            AND ma.role IN ('owner', 'booker')
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.option_request_visible_to_me(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.option_request_visible_to_me(uuid) TO authenticated;


-- -----------------------------------------------------------------------------
-- 3. Index to speed up the new org-member RLS path on user_calendar_events.
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_user_calendar_events_organization_id
  ON public.user_calendar_events (organization_id)
  WHERE organization_id IS NOT NULL;
