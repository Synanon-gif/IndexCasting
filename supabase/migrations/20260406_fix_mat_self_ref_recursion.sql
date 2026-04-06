-- =============================================================================
-- Fix: 42P17 infinite recursion on model_agency_territories
-- Date: 2026-04-06
-- Problem: clients_view_model_territories contains a self-referencing subquery
--          (FROM model_agency_territories self_mat) that causes PostgreSQL to
--          recursively evaluate SELECT policies on the same table → 42P17.
--          Chain: profiles SELECT → models SELECT → model_agency_territories SELECT
--          → clients_view_model_territories self-ref → INFINITE RECURSION.
-- Fix: DROP the redundant policy. "Authenticated can read territories" (USING true)
--      already grants SELECT to all authenticated users.
-- =============================================================================

-- 1. DROP the self-referencing SELECT policy (immediate login fix)
DROP POLICY IF EXISTS "clients_view_model_territories" ON public.model_agency_territories;

-- 2. DROP the email-matching INSERT policy (Gefahr 2 / Risiko 2 violation).
--    Redundant: agency_members_manage_own_territories_insert already covers
--    INSERT access via organization_members (no email matching).
DROP POLICY IF EXISTS "agencies_manage_territories_insert" ON public.model_agency_territories;

-- 3. Split model_locations FOR ALL policies into INSERT/UPDATE/DELETE.
--    FOR ALL includes SELECT scope. Since these policies read from models,
--    and models SELECT policies read model_agency_territories, the FOR ALL
--    policies create a latent recursion path (Risiko 5).

-- Drop FOR ALL policies
DROP POLICY IF EXISTS "Agency members can upsert model locations" ON public.model_locations;
DROP POLICY IF EXISTS "Model can upsert own location" ON public.model_locations;

-- Agency members: INSERT
CREATE POLICY "agency_members_insert_model_locations"
  ON public.model_locations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (EXISTS (
      SELECT 1
      FROM models m
      JOIN organizations o ON o.agency_id = m.agency_id AND o.type = 'agency'
      JOIN organization_members om ON om.organization_id = o.id
      WHERE m.id = model_locations.model_id AND om.user_id = auth.uid()
    ))
    OR
    (EXISTS (
      SELECT 1
      FROM models m
      JOIN bookers b ON b.agency_id = m.agency_id
      WHERE m.id = model_locations.model_id AND b.user_id = auth.uid()
    ))
  );

-- Agency members: UPDATE
CREATE POLICY "agency_members_update_model_locations"
  ON public.model_locations
  FOR UPDATE
  TO authenticated
  USING (
    (EXISTS (
      SELECT 1
      FROM models m
      JOIN organizations o ON o.agency_id = m.agency_id AND o.type = 'agency'
      JOIN organization_members om ON om.organization_id = o.id
      WHERE m.id = model_locations.model_id AND om.user_id = auth.uid()
    ))
    OR
    (EXISTS (
      SELECT 1
      FROM models m
      JOIN bookers b ON b.agency_id = m.agency_id
      WHERE m.id = model_locations.model_id AND b.user_id = auth.uid()
    ))
  )
  WITH CHECK (
    (EXISTS (
      SELECT 1
      FROM models m
      JOIN organizations o ON o.agency_id = m.agency_id AND o.type = 'agency'
      JOIN organization_members om ON om.organization_id = o.id
      WHERE m.id = model_locations.model_id AND om.user_id = auth.uid()
    ))
    OR
    (EXISTS (
      SELECT 1
      FROM models m
      JOIN bookers b ON b.agency_id = m.agency_id
      WHERE m.id = model_locations.model_id AND b.user_id = auth.uid()
    ))
  );

-- Agency members: DELETE
CREATE POLICY "agency_members_delete_model_locations"
  ON public.model_locations
  FOR DELETE
  TO authenticated
  USING (
    (EXISTS (
      SELECT 1
      FROM models m
      JOIN organizations o ON o.agency_id = m.agency_id AND o.type = 'agency'
      JOIN organization_members om ON om.organization_id = o.id
      WHERE m.id = model_locations.model_id AND om.user_id = auth.uid()
    ))
    OR
    (EXISTS (
      SELECT 1
      FROM models m
      JOIN bookers b ON b.agency_id = m.agency_id
      WHERE m.id = model_locations.model_id AND b.user_id = auth.uid()
    ))
  );

-- Model self: INSERT
CREATE POLICY "model_self_insert_location"
  ON public.model_locations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM models m
      WHERE m.id = model_locations.model_id AND m.user_id = auth.uid()
    )
  );

-- Model self: UPDATE
CREATE POLICY "model_self_update_location"
  ON public.model_locations
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM models m
      WHERE m.id = model_locations.model_id AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM models m
      WHERE m.id = model_locations.model_id AND m.user_id = auth.uid()
    )
  );

-- Model self: DELETE
CREATE POLICY "model_self_delete_location"
  ON public.model_locations
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM models m
      WHERE m.id = model_locations.model_id AND m.user_id = auth.uid()
    )
  );
