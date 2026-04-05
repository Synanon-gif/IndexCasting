-- =============================================================================
-- Phase B: models RLS auf model_assignments umstellen
--
-- Änderungen:
--   1. Client SELECT: model_agency_territories → model_assignments
--      (model_assignments.territory ist der neue Single-Source-of-Truth)
--
--   2. model_update_own_profile: agency_id IS NULL AND NOT EXISTS model_assignments
--      Dual-Guard während Übergangsphase; nach Phase F nur NOT EXISTS.
--
--   3. Agency SELECT/UPDATE/INSERT: weiterhin via models.agency_id Brücke
--      (bleibt bis Phase F unverändert, da models.agency_id noch gesetzt wird).
--
-- Wichtig: model_assignments SELECT policy ist USING(true) → kein Rückverweis
--   auf models oder profiles → KEIN 42P17 Rekursionszyklus.
--
-- Idempotent — safe to run multiple times.
-- =============================================================================

ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 1) Client SELECT — auf model_assignments umstellen
-- ---------------------------------------------------------------------------
-- Alle bekannten Varianten droppen (Reihenfolge spielt keine Rolle)
DROP POLICY IF EXISTS "Clients can read represented visible models"      ON public.models;
DROP POLICY IF EXISTS "clients_read_represented_visible_models"          ON public.models;
DROP POLICY IF EXISTS "Clients read visible models"                      ON public.models;
DROP POLICY IF EXISTS "clients_read_visible_models"                      ON public.models;

-- Neue Policy: model_assignments statt model_agency_territories
-- Kein Rückverweis auf profiles/model_assignments via subquery-join → sicher
CREATE POLICY "Clients can read represented visible models"
  ON public.models FOR SELECT
  TO authenticated
  USING (
    -- Caller ist Client (role, org-member oder org-owner)
    (
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'client'
      )
      OR EXISTS (
        SELECT 1 FROM public.organizations       o
        JOIN public.organization_members om ON om.organization_id = o.id
        WHERE o.type     = 'client'
          AND om.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.type     = 'client'
          AND o.owner_id = auth.uid()
      )
    )
    -- Sichtbarkeits-Flag
    AND (models.is_visible_commercial = true OR models.is_visible_fashion = true)
    -- Model muss aktiv sein
    AND models.is_active = true
    -- Mindestens eine Agentur-Zuweisung (Vertretung) muss existieren
    -- WICHTIG: kein weiterer JOIN auf models/profiles → kein Rekursionszyklus
    AND EXISTS (
      SELECT 1
      FROM public.model_assignments ma
      WHERE ma.model_id = models.id
    )
  );

-- ---------------------------------------------------------------------------
-- 2) model_update_own_profile — dual guard (agency_id IS NULL + NOT EXISTS assignments)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "model_update_own_profile" ON public.models;

CREATE POLICY "model_update_own_profile"
  ON public.models
  FOR UPDATE
  TO authenticated
  USING (
    -- Model editiert eigenes Profil
    user_id = auth.uid()
    -- Guard 1 (backward compat, bis Phase F): muss keine primäre Agency haben
    AND agency_id IS NULL
    -- Guard 2 (NEU, org-zentrisch): muss keine territory-Zuweisung haben
    AND NOT EXISTS (
      SELECT 1
      FROM public.model_assignments ma
      WHERE ma.model_id = models.id
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND agency_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.model_assignments ma
      WHERE ma.model_id = models.id
    )
  );

COMMENT ON POLICY "model_update_own_profile" ON public.models IS
  'Phase B v2: Models können ihr eigenes Profil nur editieren wenn agency_id IS NULL '
  'UND kein model_assignments-Eintrag existiert. '
  'Dual-Guard während Übergangsphase — agency_id IS NULL fällt nach Phase F weg.';

-- ---------------------------------------------------------------------------
-- 3) Agency SELECT — noch über models.agency_id Brücke (unverändert in Phase B)
--    Vollständiger Wechsel auf model_assignments erfolgt in Phase F.
-- ---------------------------------------------------------------------------
-- Hinweis: "Agency owner or member can read agency models" bleibt unverändert.
-- Volle Umstellung wenn models.agency_id deprecated ist (Phase F).

-- ---------------------------------------------------------------------------
-- 4) Verifikation
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'models'
      AND policyname = 'Clients can read represented visible models'
  ), '"Clients can read represented visible models" policy nicht gefunden';

  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'models'
      AND policyname = 'model_update_own_profile'
  ), '"model_update_own_profile" policy nicht gefunden';

  RAISE NOTICE 'migration_models_rls_assignments_v2: OK';
END $$;
