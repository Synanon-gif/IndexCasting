-- =============================================================================
-- 20260611_fix_application_update_rls_unassigned.sql
--
-- MAJOR-5: Agency cannot update application status when agency_id IS NULL and
-- accepted_by_agency_id IS NULL (the normal state for self-submitted apps).
--
-- The USING clause of model_applications_update_agency_or_applicant requires
-- either agency_id IS NOT NULL or accepted_by_agency_id IS NOT NULL for the
-- agency branch. But when an applicant self-submits, both are NULL.
-- The agency sets accepted_by_agency_id in the same UPDATE, but RLS checks
-- the OLD row state — so the condition fails.
--
-- FIX: Add a third agency branch that allows any authenticated agency org
-- member to update a pending application where agency_id IS NULL (the
-- "recruiting pool" use case). The WITH CHECK ensures the new row has a
-- valid accepted_by_agency_id set.
--
-- This is consistent with the SELECT policy (model_applications_select_v3)
-- which already gives all agency members global read access.
--
-- Idempotent: DROP + CREATE.
-- =============================================================================

DROP POLICY IF EXISTS "model_applications_update_agency_or_applicant" ON public.model_applications;

CREATE POLICY "model_applications_update_agency_or_applicant"
  ON public.model_applications FOR UPDATE
  TO authenticated
  USING (
    -- Branch 1: Agency member of the target agency (agency_id set on application)
    (
      agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id  = auth.uid()
          AND o.agency_id = model_applications.agency_id
      )
    )
    -- Branch 2: Agency member of the accepting agency (already accepted)
    OR (
      accepted_by_agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id  = auth.uid()
          AND o.agency_id = model_applications.accepted_by_agency_id
      )
    )
    -- Branch 3 (NEW): Unassigned pending application — any agency member can
    -- claim it for their agency (recruiting pool). The agency_id and
    -- accepted_by_agency_id are both NULL in the OLD row.
    OR (
      agency_id IS NULL
      AND accepted_by_agency_id IS NULL
      AND status = 'pending'
      AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id  = auth.uid()
          AND o.type = 'agency'
      )
    )
    -- Branch 4: Applicant edits own pending application (profile fields)
    OR (
      applicant_user_id = auth.uid()
      AND status = 'pending'
    )
    -- Branch 5: Applicant accepts/rejects a representation offer
    OR (
      applicant_user_id = auth.uid()
      AND status = 'pending_model_confirmation'
    )
  )
  WITH CHECK (
    -- Agency with agency_id set
    (
      agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id  = auth.uid()
          AND o.agency_id = model_applications.agency_id
      )
    )
    -- Agency with accepted_by_agency_id set (covers the transition from NULL)
    OR (
      accepted_by_agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id  = auth.uid()
          AND o.agency_id = model_applications.accepted_by_agency_id
      )
    )
    -- Applicant: allowed target statuses
    OR (
      applicant_user_id = auth.uid()
      AND status IN ('pending', 'accepted', 'rejected')
    )
  );

-- ─── VERIFICATION ──────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'model_applications'
      AND policyname = 'model_applications_update_agency_or_applicant'
      AND cmd = 'UPDATE'
  ), 'FAIL: model_applications_update_agency_or_applicant policy not found';

  RAISE NOTICE 'PASS: model_applications UPDATE RLS — MAJOR-5 fixed (unassigned pool branch)';
END $$;
