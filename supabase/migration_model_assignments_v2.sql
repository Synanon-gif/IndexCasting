-- =============================================================================
-- Phase A: model_assignments — org-zentrische Modell-Vertretungs-Tabelle
--
-- Ersetzt langfristig model_agency_territories (agencies.id FK) durch eine
-- Tabelle, die direkt auf organizations.id zeigt — keine Brücke über agencies.
--
-- Schema-Ziel:
--   model_assignments(model_id, organization_id, territory, role)
--   UNIQUE(model_id, territory)  → eine Org pro Land pro Model
--
-- Migration: Bestehende model_agency_territories-Zeilen werden via
--   organizations.agency_id = model_agency_territories.agency_id übertragen.
--
-- RLS auf model_assignments:
--   SELECT: USING(true) — kein JOIN zurück zu models/profiles → KEIN Rekursionszyklus
--   INSERT/UPDATE/DELETE: nur über SECURITY DEFINER RPCs (SET row_security TO off)
--
-- Idempotent — safe to run multiple times.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Assignment-Rolle ENUM
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.assignment_role AS ENUM ('mother', 'exclusive', 'non_exclusive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 1) model_assignments Tabelle
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.model_assignments (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id        UUID         NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  organization_id UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  territory       TEXT         NOT NULL,
  role            public.assignment_role NOT NULL DEFAULT 'non_exclusive',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT model_assignments_unique_model_territory UNIQUE (model_id, territory)
);

CREATE INDEX IF NOT EXISTS idx_model_assignments_model_id
  ON public.model_assignments(model_id);
CREATE INDEX IF NOT EXISTS idx_model_assignments_org_id
  ON public.model_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_model_assignments_territory
  ON public.model_assignments(territory);

-- ---------------------------------------------------------------------------
-- 2) RLS aktivieren
-- ---------------------------------------------------------------------------
ALTER TABLE public.model_assignments ENABLE ROW LEVEL SECURITY;

-- SELECT: USING(true) — kein Rückverweis auf models/profiles → kein Rekursionszyklus
-- (Datensicherheit wird auf models-RLS-Ebene durchgesetzt)
DROP POLICY IF EXISTS "model_assignments_select_authenticated" ON public.model_assignments;
CREATE POLICY "model_assignments_select_authenticated"
  ON public.model_assignments FOR SELECT TO authenticated
  USING (true);

-- Direkte Schreibzugriffe blockieren — nur SECURITY DEFINER RPCs
-- (diese setzen SET row_security TO off und umgehen die Policies)
DROP POLICY IF EXISTS "model_assignments_no_direct_insert" ON public.model_assignments;
CREATE POLICY "model_assignments_no_direct_insert"
  ON public.model_assignments FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "model_assignments_no_direct_update" ON public.model_assignments;
CREATE POLICY "model_assignments_no_direct_update"
  ON public.model_assignments FOR UPDATE TO authenticated
  USING (false);

DROP POLICY IF EXISTS "model_assignments_no_direct_delete" ON public.model_assignments;
CREATE POLICY "model_assignments_no_direct_delete"
  ON public.model_assignments FOR DELETE TO authenticated
  USING (false);

-- ---------------------------------------------------------------------------
-- 3) Daten-Migration: model_agency_territories → model_assignments
--    Brücke: organizations.agency_id = model_agency_territories.agency_id
--    ON CONFLICT DO NOTHING → idempotent
-- ---------------------------------------------------------------------------
INSERT INTO public.model_assignments (model_id, organization_id, territory, role)
SELECT
  mat.model_id,
  o.id                                          AS organization_id,
  UPPER(TRIM(
    COALESCE(NULLIF(mat.country_code, ''), NULLIF(mat.territory, ''))
  ))                                             AS territory,
  'non_exclusive'::public.assignment_role        AS role
FROM public.model_agency_territories mat
JOIN public.organizations o
  ON  o.agency_id = mat.agency_id
  AND o.type      = 'agency'
WHERE
  COALESCE(NULLIF(mat.country_code, ''), NULLIF(mat.territory, '')) IS NOT NULL
  AND TRIM(COALESCE(NULLIF(mat.country_code, ''), NULLIF(mat.territory, ''))) <> ''
ON CONFLICT (model_id, territory) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4) Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.model_assignments FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.model_assignments TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Verifikation
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO v_count FROM public.model_assignments;
  RAISE NOTICE 'migration_model_assignments_v2: model_assignments hat % Zeilen nach Migration', v_count;
  ASSERT EXISTS (
    SELECT 1 FROM pg_tables WHERE tablename = 'model_assignments' AND schemaname = 'public'
  ), 'model_assignments Tabelle nicht gefunden';
  RAISE NOTICE 'migration_model_assignments_v2: OK';
END $$;
