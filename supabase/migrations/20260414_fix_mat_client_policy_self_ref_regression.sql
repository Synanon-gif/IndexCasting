-- =============================================================================
-- Migration: 20260414_fix_mat_client_policy_self_ref_regression.sql
--
-- WHY: Regression introduced in 20260413_fix_a_territory_unique_constraint.sql.
--
-- That migration dropped and re-created "clients_view_model_territories" on
-- model_agency_territories, but the Agency-member branch contained:
--
--   FROM public.model_agency_territories self_mat
--   WHERE self_mat.id = model_agency_territories.id
--
-- This is a self-referencing SELECT — the policy queries the same table it is
-- defined on. PostgreSQL must evaluate the table's SELECT policies recursively
-- for each row in self_mat → immediate 42P17 infinite-recursion error.
--
-- Recursion chain (Risiko 11 in rls-security-patterns.mdc):
--   clients_read_visible_models (models)
--     → EXISTS (SELECT 1 FROM model_agency_territories)
--     → clients_view_model_territories evaluates for each row
--       → FROM model_agency_territories self_mat
--       → clients_view_model_territories evaluates again …
--       → 42P17
--
-- FIX: Replace the self-referencing agency branch with a direct Column
-- reference to model_agency_territories.agency_id joined only to
-- organizations and organization_members — no FROM on the same table.
--
-- This identical fix was already applied in 20260406_fix_mat_self_ref_recursion.sql
-- but was inadvertently reverted by 20260413_fix_a_territory_unique_constraint.sql.
--
-- Idempotent: DROP IF EXISTS + CREATE.
-- =============================================================================


-- ─── 1. Drop the broken policy ───────────────────────────────────────────────

DROP POLICY IF EXISTS "clients_view_model_territories" ON public.model_agency_territories;


-- ─── 2. Re-create with direct column reference (no self-join) ────────────────
--
-- Agency-member branch now uses model_agency_territories.agency_id as a
-- direct column reference. No FROM on model_agency_territories itself.
-- All other branches (admin / client-org-member / client-owner) are unchanged.

CREATE POLICY "clients_view_model_territories"
  ON public.model_agency_territories
  FOR SELECT
  TO authenticated
  USING (
    -- Branch 1: Admin always has access
    public.is_current_user_admin()

    -- Branch 2: Client org member
    OR EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND o.type = 'client'
    )

    -- Branch 3: Client org owner (orgs without organization_members entry)
    OR EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.owner_id = auth.uid()
        AND o.type = 'client'
    )

    -- Branch 4: Agency member — direct column reference to agency_id.
    -- CRITICAL: do NOT use FROM model_agency_territories inside this policy.
    -- model_agency_territories.agency_id is a direct column on the current row
    -- and can be referenced without an additional SELECT on the same table.
    OR EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.agency_id = model_agency_territories.agency_id
        AND om.user_id  = auth.uid()
        AND o.type      = 'agency'
    )
  );


-- ─── 3. Verification ─────────────────────────────────────────────────────────

DO $$
BEGIN
  -- No self-referencing alias should appear in any policy on this table
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'model_agency_territories'
      AND (qual ILIKE '%self_mat%' OR qual ILIKE '%from public.model_agency_territories%')
  ), 'FAIL: self-referencing FROM still present in a model_agency_territories policy';

  -- The fixed policy must exist
  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename  = 'model_agency_territories'
      AND policyname = 'clients_view_model_territories'
      AND cmd        = 'SELECT'
  ), 'FAIL: clients_view_model_territories SELECT policy not found after fix';

  RAISE NOTICE 'OK: clients_view_model_territories is self-reference-free';
END;
$$;
