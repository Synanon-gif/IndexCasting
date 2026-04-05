-- ============================================================================
-- Fix: RLS infinite recursion on models table (42P17)
-- Date: 2026-04-05
--
-- Root cause:
--   profiles -> models (profiles_org_scoped_read)
--     -> model_agency_territories ("Clients can read represented visible models")
--       -> models (agency_members_manage_own_territories ALL policy)  => RECURSION
--       -> profiles (Agencies can manage their territories ALL policy) => RECURSION
--
-- Two ALL policies on model_agency_territories include SELECT in their scope,
-- creating circular references back to models/profiles during RLS expansion.
-- PostgreSQL detects this at policy-expansion time and throws 42P17, even though
-- the existing SELECT policy ("Authenticated can read territories", qual=true)
-- would short-circuit at runtime.
--
-- Fix: Split both ALL policies into INSERT / UPDATE / DELETE only.
-- The existing SELECT policy (true) continues to handle read access.
-- ============================================================================

-- ── 1. Drop the two ALL policies causing recursion ────────────────────────────

DROP POLICY IF EXISTS "agency_members_manage_own_territories" ON public.model_agency_territories;
DROP POLICY IF EXISTS "Agencies can manage their territories" ON public.model_agency_territories;

-- ── 2. Re-create "agency_members_manage_own_territories" as INSERT/UPDATE/DELETE

CREATE POLICY "agency_members_manage_own_territories_insert"
  ON public.model_agency_territories
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (EXISTS (
      SELECT 1
      FROM models m
      JOIN organizations o ON o.agency_id = m.agency_id
      JOIN organization_members om ON om.organization_id = o.id
      WHERE m.id = model_agency_territories.model_id
        AND om.user_id = auth.uid()
    ))
    OR (EXISTS (
      SELECT 1
      FROM models m
      JOIN bookers bk ON bk.agency_id = m.agency_id
      WHERE m.id = model_agency_territories.model_id
        AND bk.user_id = auth.uid()
    ))
    OR (EXISTS (
      SELECT 1
      FROM models m
      JOIN organizations o ON o.agency_id = m.agency_id
      WHERE m.id = model_agency_territories.model_id
        AND o.owner_id = auth.uid()
    ))
  );

CREATE POLICY "agency_members_manage_own_territories_update"
  ON public.model_agency_territories
  FOR UPDATE
  TO authenticated
  USING (
    (EXISTS (
      SELECT 1
      FROM models m
      JOIN organizations o ON o.agency_id = m.agency_id
      JOIN organization_members om ON om.organization_id = o.id
      WHERE m.id = model_agency_territories.model_id
        AND om.user_id = auth.uid()
    ))
    OR (EXISTS (
      SELECT 1
      FROM models m
      JOIN bookers bk ON bk.agency_id = m.agency_id
      WHERE m.id = model_agency_territories.model_id
        AND bk.user_id = auth.uid()
    ))
    OR (EXISTS (
      SELECT 1
      FROM models m
      JOIN organizations o ON o.agency_id = m.agency_id
      WHERE m.id = model_agency_territories.model_id
        AND o.owner_id = auth.uid()
    ))
  )
  WITH CHECK (
    (EXISTS (
      SELECT 1
      FROM models m
      JOIN organizations o ON o.agency_id = m.agency_id
      JOIN organization_members om ON om.organization_id = o.id
      WHERE m.id = model_agency_territories.model_id
        AND om.user_id = auth.uid()
    ))
    OR (EXISTS (
      SELECT 1
      FROM models m
      JOIN bookers bk ON bk.agency_id = m.agency_id
      WHERE m.id = model_agency_territories.model_id
        AND bk.user_id = auth.uid()
    ))
    OR (EXISTS (
      SELECT 1
      FROM models m
      JOIN organizations o ON o.agency_id = m.agency_id
      WHERE m.id = model_agency_territories.model_id
        AND o.owner_id = auth.uid()
    ))
  );

CREATE POLICY "agency_members_manage_own_territories_delete"
  ON public.model_agency_territories
  FOR DELETE
  TO authenticated
  USING (
    (EXISTS (
      SELECT 1
      FROM models m
      JOIN organizations o ON o.agency_id = m.agency_id
      JOIN organization_members om ON om.organization_id = o.id
      WHERE m.id = model_agency_territories.model_id
        AND om.user_id = auth.uid()
    ))
    OR (EXISTS (
      SELECT 1
      FROM models m
      JOIN bookers bk ON bk.agency_id = m.agency_id
      WHERE m.id = model_agency_territories.model_id
        AND bk.user_id = auth.uid()
    ))
    OR (EXISTS (
      SELECT 1
      FROM models m
      JOIN organizations o ON o.agency_id = m.agency_id
      WHERE m.id = model_agency_territories.model_id
        AND o.owner_id = auth.uid()
    ))
  );

-- ── 3. Re-create "Agencies can manage their territories" as INSERT/UPDATE/DELETE

CREATE POLICY "agencies_manage_territories_insert"
  ON public.model_agency_territories
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (EXISTS (
      SELECT 1
      FROM agencies a
      JOIN profiles pr ON lower(TRIM(BOTH FROM pr.email)) = lower(TRIM(BOTH FROM a.email))
      WHERE a.id = model_agency_territories.agency_id
        AND pr.id = auth.uid()
    ))
    OR (EXISTS (
      SELECT 1
      FROM organizations o
      JOIN organization_members om ON om.organization_id = o.id
      WHERE o.type = 'agency'::organization_type
        AND o.agency_id = model_agency_territories.agency_id
        AND om.user_id = auth.uid()
        AND om.role = ANY (ARRAY['owner'::org_member_role, 'booker'::org_member_role, 'employee'::org_member_role])
    ))
  );

CREATE POLICY "agencies_manage_territories_update"
  ON public.model_agency_territories
  FOR UPDATE
  TO authenticated
  USING (
    (EXISTS (
      SELECT 1
      FROM agencies a
      JOIN profiles pr ON lower(TRIM(BOTH FROM pr.email)) = lower(TRIM(BOTH FROM a.email))
      WHERE a.id = model_agency_territories.agency_id
        AND pr.id = auth.uid()
    ))
    OR (EXISTS (
      SELECT 1
      FROM organizations o
      JOIN organization_members om ON om.organization_id = o.id
      WHERE o.type = 'agency'::organization_type
        AND o.agency_id = model_agency_territories.agency_id
        AND om.user_id = auth.uid()
        AND om.role = ANY (ARRAY['owner'::org_member_role, 'booker'::org_member_role, 'employee'::org_member_role])
    ))
  )
  WITH CHECK (
    (EXISTS (
      SELECT 1
      FROM agencies a
      JOIN profiles pr ON lower(TRIM(BOTH FROM pr.email)) = lower(TRIM(BOTH FROM a.email))
      WHERE a.id = model_agency_territories.agency_id
        AND pr.id = auth.uid()
    ))
    OR (EXISTS (
      SELECT 1
      FROM organizations o
      JOIN organization_members om ON om.organization_id = o.id
      WHERE o.type = 'agency'::organization_type
        AND o.agency_id = model_agency_territories.agency_id
        AND om.user_id = auth.uid()
        AND om.role = ANY (ARRAY['owner'::org_member_role, 'booker'::org_member_role, 'employee'::org_member_role])
    ))
  );

CREATE POLICY "agencies_manage_territories_delete"
  ON public.model_agency_territories
  FOR DELETE
  TO authenticated
  USING (
    (EXISTS (
      SELECT 1
      FROM agencies a
      JOIN profiles pr ON lower(TRIM(BOTH FROM pr.email)) = lower(TRIM(BOTH FROM a.email))
      WHERE a.id = model_agency_territories.agency_id
        AND pr.id = auth.uid()
    ))
    OR (EXISTS (
      SELECT 1
      FROM organizations o
      JOIN organization_members om ON om.organization_id = o.id
      WHERE o.type = 'agency'::organization_type
        AND o.agency_id = model_agency_territories.agency_id
        AND om.user_id = auth.uid()
        AND om.role = ANY (ARRAY['owner'::org_member_role, 'booker'::org_member_role, 'employee'::org_member_role])
    ))
  );

-- ============================================================================
-- After this migration, model_agency_territories policies are:
--   SELECT: "Authenticated can read territories" (true) — unchanged
--   INSERT: agency_members_manage_own_territories_insert + agencies_manage_territories_insert
--   UPDATE: agency_members_manage_own_territories_update + agencies_manage_territories_update
--   DELETE: agency_members_manage_own_territories_delete + agencies_manage_territories_delete
--
-- No SELECT policy references models or profiles, breaking the recursion cycle.
-- ============================================================================
