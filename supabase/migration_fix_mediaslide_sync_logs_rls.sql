-- =============================================================================
-- Fix: mediaslide_sync_logs RLS
--
-- The original migration_mediaslide_sync_logs.sql had two bugs:
--
-- 1. SELECT policy: `om.organization_id = m.agency_id` compared organizations.id
--    with agencies.id — two different schema entities. Agency members could NOT
--    read their own sync logs (only the bookers-table fallback worked).
--    Fix: join through organizations to resolve the correct agency_id.
--
-- 2. INSERT policy: `WITH CHECK (true)` allowed ANY authenticated user to insert.
--    Fix: restrict INSERT to agency members of the model's agency or to system-level
--    rows (model_id IS NULL) which are inserted by the backend service.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Fix SELECT policy
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Agency members can read sync logs for own models" ON public.mediaslide_sync_logs;
CREATE POLICY "Agency members can read sync logs for own models"
  ON public.mediaslide_sync_logs
  FOR SELECT
  TO authenticated
  USING (
    -- System-level entries (no specific model) are visible to all authenticated users.
    model_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.models m
      WHERE m.id = mediaslide_sync_logs.model_id
        AND (
          -- Agency owner/booker via organization_members (correct join through organizations).
          EXISTS (
            SELECT 1
            FROM public.organization_members om
            JOIN public.organizations o ON o.id = om.organization_id
            WHERE om.user_id = auth.uid()
              AND o.agency_id = m.agency_id
              AND om.role IN ('owner', 'booker')
          )
          -- Fallback: bookers table (older sign-up path).
          OR EXISTS (
            SELECT 1
            FROM public.bookers b
            WHERE b.user_id = auth.uid()
              AND b.agency_id = m.agency_id
          )
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Fix INSERT policy — restrict to agency members only
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Service can insert sync logs" ON public.mediaslide_sync_logs;
CREATE POLICY "Agency service can insert sync logs"
  ON public.mediaslide_sync_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- System-level entries (no specific model) may be inserted by any authenticated service call.
    model_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.models m
      WHERE m.id = mediaslide_sync_logs.model_id
        AND (
          EXISTS (
            SELECT 1
            FROM public.organization_members om
            JOIN public.organizations o ON o.id = om.organization_id
            WHERE om.user_id = auth.uid()
              AND o.agency_id = m.agency_id
              AND om.role IN ('owner', 'booker')
          )
          OR EXISTS (
            SELECT 1
            FROM public.bookers b
            WHERE b.user_id = auth.uid()
              AND b.agency_id = m.agency_id
          )
        )
    )
  );
