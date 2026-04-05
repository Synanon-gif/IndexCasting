-- =============================================================================
-- Fix: profiles RLS recursion v2 (42P17) — Login für ALLE Rollen blockiert
-- Date: 2026-04-05
--
-- Root cause: migration_models_rls_assignments_v2.sql re-introduced a
-- profiles reference in the "Clients can read represented visible models"
-- policy on models, undoing the fix from migration_fix_profiles_rls_recursion.sql.
--
-- Recursion chain:
--   profiles SELECT (profiles_org_scoped_read)
--     → subquery on models
--     → models SELECT RLS applies
--     → "Clients can read..." policy
--     → EXISTS (SELECT 1 FROM profiles p WHERE ...)
--     → profiles SELECT RLS applies again
--     → 42P17 INFINITE RECURSION
--
-- Fix: Remove the profiles reference from the models client-read policy.
-- The two remaining client-detection clauses (via organizations +
-- organization_members) cover the same use case without touching profiles.
-- Every client user is either an org member or an org owner.
--
-- Idempotent — safe to run multiple times.
-- =============================================================================

DROP POLICY IF EXISTS "Clients can read represented visible models" ON public.models;

CREATE POLICY "Clients can read represented visible models"
  ON public.models FOR SELECT
  TO authenticated
  USING (
    (
      EXISTS (
        SELECT 1 FROM public.organizations o
        JOIN public.organization_members om ON om.organization_id = o.id
        WHERE o.type = 'client'::organization_type
          AND om.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.type = 'client'::organization_type
          AND o.owner_id = auth.uid()
      )
    )
    AND (is_visible_commercial = true OR is_visible_fashion = true)
    AND is_active = true
    AND EXISTS (
      SELECT 1 FROM public.model_assignments ma
      WHERE ma.model_id = models.id
    )
  );

-- Verification: policy must exist and must NOT reference profiles
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'models'
      AND policyname = 'Clients can read represented visible models'
  ), '"Clients can read represented visible models" policy not found after recreation';

  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'models'
      AND policyname = 'Clients can read represented visible models'
      AND qual::text ILIKE '%profiles%'
  ), 'Policy still references profiles — recursion not fixed!';

  RAISE NOTICE 'migration_fix_profiles_rls_recursion_v2: OK — no profiles reference in models client-read policy';
END $$;
