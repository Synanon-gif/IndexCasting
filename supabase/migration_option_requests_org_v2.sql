-- =============================================================================
-- Phase D: option_requests — vollständig org-zentrisch
--
-- Neue Spalten:
--   agency_organization_id  → organizations.id (type='agency')
--   client_organization_id  → organizations.id (type='client')
--
-- Daten-Migration:
--   agency_organization_id:  Brücke organizations.agency_id = option_requests.agency_id
--   client_organization_id:  Direkt option_requests.organization_id (bereits gesetzt)
--
-- option_request_visible_to_me() aktualisiert:
--   - Client-Sicht: client_organization_id OR (organization_id fallback) OR client_id
--   - Agency-Sicht:  agency_organization_id OR (organizations.agency_id fallback)
--   - Model-Sicht:   unverändert
--
-- Alte Spalten (agency_id, client_id, organization_id) bleiben erhalten
-- für Backward-Compat bis Phase F.
--
-- Idempotent — safe to run multiple times.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Neue Spalten hinzufügen
-- ---------------------------------------------------------------------------
ALTER TABLE public.option_requests
  ADD COLUMN IF NOT EXISTS agency_organization_id  UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_organization_id  UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_option_requests_agency_org_id
  ON public.option_requests(agency_organization_id);
CREATE INDEX IF NOT EXISTS idx_option_requests_client_org_id
  ON public.option_requests(client_organization_id);

-- ---------------------------------------------------------------------------
-- 2) Daten-Migration
-- ---------------------------------------------------------------------------

-- agency_organization_id: Brücke über organizations.agency_id
UPDATE public.option_requests oq
SET agency_organization_id = o.id
FROM public.organizations o
WHERE o.agency_id = oq.agency_id
  AND o.type      = 'agency'
  AND oq.agency_organization_id IS NULL
  AND oq.agency_id IS NOT NULL;

-- client_organization_id: aus bestehendem organization_id (Client-Seite)
UPDATE public.option_requests oq
SET client_organization_id = oq.organization_id
WHERE oq.organization_id IS NOT NULL
  AND oq.client_organization_id IS NULL;

-- ---------------------------------------------------------------------------
-- 3) option_request_visible_to_me — aktualisiert mit neuen Org-Spalten
--    Fallback auf alte Spalten bleibt für Rows ohne neue Felder.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.option_request_visible_to_me(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.option_requests oq
    WHERE oq.id = p_request_id
      AND (
        -- Model kann eigene Requests sehen
        EXISTS (
          SELECT 1 FROM public.models mo
          WHERE mo.id = oq.model_id AND mo.user_id = auth.uid()
        )

        -- Client via neue org-zentrische Spalte
        OR (
          oq.client_organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organization_members mc
            WHERE mc.organization_id = oq.client_organization_id
              AND mc.user_id         = auth.uid()
          )
        )

        -- Client via alte organization_id (Fallback, backward compat)
        OR (
          oq.client_organization_id IS NULL
          AND oq.organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organizations oc
            JOIN public.organization_members mc ON mc.organization_id = oc.id
            WHERE oc.id = oq.organization_id
              AND oc.type = 'client'
              AND mc.user_id = auth.uid()
          )
        )

        -- Client via Legacy client_id (kein Org-Eintrag)
        OR (
          oq.client_organization_id IS NULL
          AND oq.organization_id IS NULL
          AND oq.client_id = auth.uid()
        )

        -- Agency via neue org-zentrische Spalte
        OR (
          oq.agency_organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organization_members ma
            WHERE ma.organization_id = oq.agency_organization_id
              AND ma.user_id         = auth.uid()
              AND (
                ma.role = 'owner'
                OR (
                  ma.role = 'booker'
                  AND (
                    oq.agency_assignee_user_id IS NULL
                    OR oq.agency_assignee_user_id = auth.uid()
                  )
                )
              )
          )
        )

        -- Agency via alte agencies.id Brücke (Fallback, backward compat)
        OR (
          oq.agency_organization_id IS NULL
          AND oq.agency_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organizations oa
            JOIN public.organization_members ma ON ma.organization_id = oa.id
            WHERE oa.agency_id = oq.agency_id
              AND oa.type = 'agency'
              AND ma.user_id = auth.uid()
              AND (
                ma.role = 'owner'
                OR (
                  ma.role = 'booker'
                  AND (
                    oq.agency_assignee_user_id IS NULL
                    OR oq.agency_assignee_user_id = auth.uid()
                  )
                )
              )
          )
        )
      )
  );
$$;

REVOKE ALL    ON FUNCTION public.option_request_visible_to_me(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.option_request_visible_to_me(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) RLS auf option_requests aktualisieren
-- ---------------------------------------------------------------------------
ALTER TABLE public.option_requests ENABLE ROW LEVEL SECURITY;

-- DROP alle bekannten alten Policies
DROP POLICY IF EXISTS "Clients can view their option requests"       ON public.option_requests;
DROP POLICY IF EXISTS "Agencies can view assigned option requests"   ON public.option_requests;
DROP POLICY IF EXISTS "option_requests_client_select"                ON public.option_requests;
DROP POLICY IF EXISTS "option_requests_agency_select"                ON public.option_requests;
DROP POLICY IF EXISTS "option_requests_model_select"                 ON public.option_requests;
DROP POLICY IF EXISTS "option_requests_select"                       ON public.option_requests;

-- Einheitliche SELECT-Policy via Sichtbarkeits-Funktion
CREATE POLICY "option_requests_select"
  ON public.option_requests FOR SELECT
  TO authenticated
  USING (public.option_request_visible_to_me(id));

-- INSERT: Clients (neue org-zentrische Spalte wird gesetzt)
DROP POLICY IF EXISTS "option_requests_insert" ON public.option_requests;
CREATE POLICY "option_requests_insert"
  ON public.option_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Ersteller muss Mitglied der client_organization_id sein
    (
      client_organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id = client_organization_id
          AND om.user_id         = auth.uid()
      )
    )
    -- Legacy: kein Org-Kontext → client_id muss der eigene User sein
    OR (
      client_organization_id IS NULL
      AND (client_id = auth.uid() OR created_by = auth.uid())
    )
  );

-- UPDATE: Beide Seiten dürfen updaten (Status-Negotiation)
DROP POLICY IF EXISTS "option_requests_update" ON public.option_requests;
CREATE POLICY "option_requests_update"
  ON public.option_requests FOR UPDATE
  TO authenticated
  USING (public.option_request_visible_to_me(id))
  WITH CHECK (public.option_request_visible_to_me(id));

-- ---------------------------------------------------------------------------
-- 5) Verifikation
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'option_requests'
      AND column_name  = 'agency_organization_id'
  ), 'agency_organization_id Spalte nicht gefunden';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'option_requests'
      AND column_name  = 'client_organization_id'
  ), 'client_organization_id Spalte nicht gefunden';

  RAISE NOTICE 'migration_option_requests_org_v2: OK';
END $$;
