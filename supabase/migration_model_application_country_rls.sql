-- =============================================================================
-- Model Applications: add country_code column + fix SELECT RLS
--
-- Problem 1: model_applications has no country_code column.
--   Models filter and get filtered by country — this field must exist on
--   applications and flow through to the models table on accept.
--
-- Problem 2: SELECT policy "Scoped can read model applications"
--   (migration_security_tighten.sql) requires model_applications.agency_id to
--   match an agency the viewer is a member of. Since models apply without
--   setting agency_id (null), agency recruiters cannot see ANY applications in
--   the Recruiting tab — the swipe queue is permanently empty.
--
-- Fix:
--   1. Add country_code text column (nullable, backward-compatible).
--   2. Replace the SELECT policy so that any authenticated agency member
--      (Owner via organizations.owner_id, Member via organization_members,
--       Booker via bookers) sees ALL applications regardless of agency_id.
--      Applicants continue to see only their own rows.
-- =============================================================================

-- ─── 1. Add country_code column ───────────────────────────────────────────────
ALTER TABLE public.model_applications
  ADD COLUMN IF NOT EXISTS country_code text;

-- ─── 2. Fix SELECT policy ─────────────────────────────────────────────────────
-- Drop all existing SELECT policies that may conflict.
DROP POLICY IF EXISTS "Authenticated can read applications"        ON public.model_applications;
DROP POLICY IF EXISTS "Models can read own applications"           ON public.model_applications;
DROP POLICY IF EXISTS "Scoped can read model applications"         ON public.model_applications;
DROP POLICY IF EXISTS "model_applications_select_v2"              ON public.model_applications;
DROP POLICY IF EXISTS "model_applications_select_v3"              ON public.model_applications;

-- New policy: applicants see their own rows; agency members (owner, org member,
-- or booker) see all rows for recruiting purposes.
CREATE POLICY "model_applications_select_v3"
  ON public.model_applications FOR SELECT
  TO authenticated
  USING (
    -- Model applicant sees own applications
    applicant_user_id = auth.uid()

    -- Agency Owner or organization member of any agency-type org sees all
    OR EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.type = 'agency'
        AND (
          o.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.organization_members om
            WHERE om.organization_id = o.id
              AND om.user_id = auth.uid()
          )
        )
    )

    -- Legacy bookers table: bookers not in organization_members also see all
    OR EXISTS (
      SELECT 1
      FROM public.bookers b
      WHERE b.user_id = auth.uid()
    )
  );

-- ─── Verification query (run manually to check) ───────────────────────────────
-- SELECT policyname, cmd, qual
-- FROM pg_policies
-- WHERE tablename = 'model_applications'
-- ORDER BY cmd, policyname;
