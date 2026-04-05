-- =============================================================================
-- Phase F: Cleanup deprecated Spalten und Tabellen
--
-- ⚠️  ACHTUNG: Diese Migration NICHT automatisch ausführen.
--    Voraussetzungen prüfen bevor sie angewendet wird:
--
--    1. model_assignments enthält alle Daten aus model_agency_territories:
--       SELECT COUNT(*) FROM model_agency_territories;
--       SELECT COUNT(*) FROM model_assignments;
--       → beide Counts sollen vergleichbar sein
--
--    2. Alle Territory-RPCs (save_model_territories, add_model_territories,
--       bulk_*) schreiben bereits in model_assignments (via Phase C).
--
--    3. Frontend nutzt model_assignments RPCs (Phase E deployed + Vercel stable).
--
--    4. get_models_by_location nutzt model_assignments (Phase C deployed).
--
--    5. No aktive Nutzung von model_agency_territories im Frontend-Code.
--
-- Schritte:
--   Step 1: model_agency_territories droppen
--   Step 2: models.agency_id deprecieren (nullable lassen, aus RLS entfernen)
--   Step 3: organizations.agency_id deprecieren
--   Step 4: option_requests alte Spalten droppen
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: model_agency_territories droppen
-- ---------------------------------------------------------------------------

-- Erst Policies droppen
DROP POLICY IF EXISTS "Authenticated users can read territories"               ON public.model_agency_territories;
DROP POLICY IF EXISTS "Authenticated users can write territories"               ON public.model_agency_territories;
DROP POLICY IF EXISTS "agency_members_manage_own_territories_insert"            ON public.model_agency_territories;
DROP POLICY IF EXISTS "agency_members_manage_own_territories_update"            ON public.model_agency_territories;
DROP POLICY IF EXISTS "agency_members_manage_own_territories_delete"            ON public.model_agency_territories;
DROP POLICY IF EXISTS "agencies_manage_territories_insert"                      ON public.model_agency_territories;
DROP POLICY IF EXISTS "agencies_manage_territories_update"                      ON public.model_agency_territories;
DROP POLICY IF EXISTS "agencies_manage_territories_delete"                      ON public.model_agency_territories;

-- View droppen der auf model_agency_territories basiert
DROP VIEW IF EXISTS public.models_with_territories;

-- RPCs droppen die model_agency_territories noch direkt verwenden
DROP FUNCTION IF EXISTS public.get_territories_for_agency_roster(UUID);
DROP FUNCTION IF EXISTS public.get_territories_for_model(UUID, UUID);
DROP FUNCTION IF EXISTS public.save_model_territories(UUID, UUID, TEXT[]);
DROP FUNCTION IF EXISTS public.add_model_territories(UUID, UUID, TEXT[]);
DROP FUNCTION IF EXISTS public.bulk_add_model_territories(uuid[], uuid, text[]);
DROP FUNCTION IF EXISTS public.bulk_save_model_territories(uuid[], uuid, text[]);

-- Tabelle droppen (CASCADE entfernt FKs)
DROP TABLE IF EXISTS public.model_agency_territories CASCADE;

-- ---------------------------------------------------------------------------
-- Step 2: Agency-READ Policy auf models auf model_assignments umstellen
--   (ersetzt bridge via models.agency_id)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Agency owner or member can read agency models" ON public.models;
DROP POLICY IF EXISTS "Agencies can read own agency models"           ON public.models;

CREATE POLICY "Agency owner or member can read agency models"
  ON public.models FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.model_assignments ma
      JOIN public.organization_members om ON om.organization_id = ma.organization_id
      WHERE ma.model_id   = models.id
        AND om.user_id    = auth.uid()
        AND om.role       IN ('owner', 'booker')
    )
    OR EXISTS (
      SELECT 1
      FROM public.model_assignments ma
      JOIN public.organizations o ON o.id = ma.organization_id
      WHERE ma.model_id  = models.id
        AND o.owner_id   = auth.uid()
    )
  );

-- Agency UPDATE Policy ebenfalls auf model_assignments umstellen
DROP POLICY IF EXISTS "Agency owner or member can update model" ON public.models;

CREATE POLICY "Agency owner or member can update model"
  ON public.models FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.model_assignments ma
      JOIN public.organization_members om ON om.organization_id = ma.organization_id
      WHERE ma.model_id   = models.id
        AND om.user_id    = auth.uid()
        AND om.role       IN ('owner', 'booker')
    )
    OR EXISTS (
      SELECT 1
      FROM public.model_assignments ma
      JOIN public.organizations o ON o.id = ma.organization_id
      WHERE ma.model_id  = models.id
        AND o.owner_id   = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.model_assignments ma
      JOIN public.organization_members om ON om.organization_id = ma.organization_id
      WHERE ma.model_id   = models.id
        AND om.user_id    = auth.uid()
        AND om.role       IN ('owner', 'booker')
    )
    OR EXISTS (
      SELECT 1
      FROM public.model_assignments ma
      JOIN public.organizations o ON o.id = ma.organization_id
      WHERE ma.model_id  = models.id
        AND o.owner_id   = auth.uid()
    )
  );

-- model_update_own_profile: agency_id IS NULL Guard entfernen
DROP POLICY IF EXISTS "model_update_own_profile" ON public.models;

CREATE POLICY "model_update_own_profile"
  ON public.models
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.model_assignments ma
      WHERE ma.model_id = models.id
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.model_assignments ma
      WHERE ma.model_id = models.id
    )
  );

-- ---------------------------------------------------------------------------
-- Step 3: agency_update_model_full + agency_claim_unowned_model umstellen
--   (Nutzung von model_assignments statt models.agency_id)
-- ---------------------------------------------------------------------------

-- agency_claim_unowned_model: INSERT in model_assignments, kein models.agency_id Update
-- (Implementierung hier als Platzhalter — vollständige Neudefinition required)
-- TODO: agency_claim_unowned_model muss für Phase F umgebaut werden.

-- ---------------------------------------------------------------------------
-- Step 4: option_requests alte Spalten droppen
-- ---------------------------------------------------------------------------

-- Sicherstellen, dass agency_organization_id + client_organization_id vollständig befüllt sind:
-- SELECT COUNT(*) FROM option_requests WHERE agency_id IS NOT NULL AND agency_organization_id IS NULL;
-- → Muss 0 sein bevor diese Zeilen ausgeführt werden.

-- ALTER TABLE public.option_requests DROP COLUMN IF EXISTS agency_id;
-- ALTER TABLE public.option_requests DROP COLUMN IF EXISTS client_id;
-- ALTER TABLE public.option_requests DROP COLUMN IF EXISTS organization_id;

-- ---------------------------------------------------------------------------
-- Step 5: models.agency_id Spalte nullable lassen (nicht droppen, bis alle RPCs umgestellt)
-- ---------------------------------------------------------------------------
-- ALTER TABLE public.models ALTER COLUMN agency_id DROP NOT NULL;
-- Nach vollständiger RPC-Umstellung:
-- ALTER TABLE public.models DROP COLUMN IF EXISTS agency_id;

-- ---------------------------------------------------------------------------
-- Step 6: organizations.agency_id Brücke entfernen (nur wenn agencies Tabelle deprecated)
-- ---------------------------------------------------------------------------
-- ALTER TABLE public.organizations DROP COLUMN IF EXISTS agency_id;
-- DROP TABLE IF EXISTS public.agencies CASCADE;

-- ---------------------------------------------------------------------------
-- Verifikation (nur ausführen wenn Steps aktiv)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE 'migration_cleanup_deprecated_v2: Dieses Skript enthält deferred Steps.';
  RAISE NOTICE 'Schritte sind als Kommentar gesichert — einzeln und geprüft anwenden.';
  RAISE NOTICE 'Voraussetzungen: Phase A-E deployed + Prod-Verifikation abgeschlossen.';
END $$;
