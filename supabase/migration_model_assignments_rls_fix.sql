-- =============================================================================
-- Fix 2: model_assignments RLS — org-scoped SELECT statt USING(true)
--
-- Problem: USING(true) → jeder authentifizierte User sieht alle Assignments
-- (organization_id, territory, role) aller Models → Cross-Tenant-Datenleck.
--
-- Lösung: SECURITY DEFINER Hilfsfunktion get_my_organization_ids() liest nur
-- organization_members (kein JOIN auf profiles/models → kein 42P17-Zyklus).
--
-- Rekursionsanalyse:
--   model_assignments SELECT policy
--     → get_my_organization_ids() → organization_members (kein RLS-Rückverweis)
--     → models.user_id = auth.uid() (direkte Spalte, kein RLS-Join)
--   Kein Zyklus zurück nach profiles oder models via RLS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Hilfsfunktion: gibt alle organization_ids des aktuellen Users zurück
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_organization_ids()
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT ARRAY(
    SELECT om.organization_id
    FROM public.organization_members om
    WHERE om.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.get_my_organization_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_organization_ids() TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. Org-scoped SELECT Policy (ersetzt USING(true))
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "model_assignments_select_authenticated" ON public.model_assignments;

CREATE POLICY "model_assignments_select_org_scoped"
  ON public.model_assignments FOR SELECT
  TO authenticated
  USING (
    -- Agency/Client-Mitglied: sieht nur Assignments der eigenen Org
    organization_id = ANY(public.get_my_organization_ids())
    -- Model: sieht eigene Assignments (alle Orgs, die das Model vertreten)
    OR EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = model_assignments.model_id
        AND m.user_id = auth.uid()
    )
  );

-- Bestehende INSERT/UPDATE/DELETE-Blockade (nur RPCs dürfen schreiben) bleibt unverändert.
-- Keine Änderung an den bestehenden INSERT/UPDATE/DELETE-Policies nötig.
