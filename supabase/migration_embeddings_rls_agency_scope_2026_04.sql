-- =============================================================================
-- Tighten model_embeddings SELECT RLS: scope agent reads to own agency only.
--
-- Security finding (Attack Simulation 2026-04, HOCH):
--   Previous policy "Embeddings readable by agency and client" allowed ANY
--   authenticated agent to read ALL model_embeddings across ALL agencies.
--   A booker from Agency A could run SELECT * FROM model_embeddings to extract
--   similarity vectors for every model on the platform and reconstruct a
--   cross-agency similarity profile without using the guarded match_models() RPC.
--
-- Fix:
--   - Agents (role = 'agent') may only read embeddings for models whose
--     agency_id matches the agency linked to the caller's own organization
--     (via organization_members → organizations.agency_id).
--   - Clients (role = 'client') retain read access to support matching UI —
--     their direct table access is already further limited by has_platform_access()
--     inside match_models(). No cross-agency isolation is needed for clients
--     because clients do not see agency attribution in the embedding row.
--   - Admins retain unrestricted read access.
--
-- Join path for agents:
--   auth.uid()
--     → organization_members.user_id
--     → organizations.id  (type = 'agency')
--     → organizations.agency_id
--     ← models.agency_id
--     ← model_embeddings.model_id
--
-- Idempotent: DROP IF EXISTS + CREATE replaces the prior policy safely.
-- =============================================================================

DROP POLICY IF EXISTS "Embeddings readable by agency and client" ON public.model_embeddings;
DROP POLICY IF EXISTS "Embeddings readable scoped"               ON public.model_embeddings;

CREATE POLICY "Embeddings readable scoped"
  ON public.model_embeddings
  FOR SELECT
  TO authenticated
  USING (
    -- Platform admins may read everything
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.is_admin = true
    )
    OR
    -- Client users may read (needed for match_models / swipe UI)
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'client'
    )
    OR
    -- Agent users may ONLY read embeddings for models in their own agency.
    -- Join path: caller → organization_members → organizations (type=agency)
    --            → agencies.id ← models.agency_id ← model_embeddings.model_id
    EXISTS (
      SELECT 1
      FROM public.profiles           p
      JOIN public.organization_members om  ON om.user_id        = p.id
      JOIN public.organizations        org ON org.id            = om.organization_id
                                          AND org.type          = 'agency'
      JOIN public.models               m   ON m.agency_id       = org.agency_id
      WHERE p.id             = auth.uid()
        AND p.role           = 'agent'
        AND m.id             = model_embeddings.model_id
    )
  );

-- Also tighten the write policy (ALL) which currently checks only role='agent'
-- without scoping to the caller's own agency — same cross-agency gap.
DROP POLICY IF EXISTS "Embeddings upsert own model"             ON public.model_embeddings;
DROP POLICY IF EXISTS "Agency can upsert own model embeddings"  ON public.model_embeddings;

CREATE POLICY "Agency can upsert own model embeddings"
  ON public.model_embeddings
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles           p
      JOIN public.organization_members om  ON om.user_id        = p.id
      JOIN public.organizations        org ON org.id            = om.organization_id
                                          AND org.type          = 'agency'
      JOIN public.models               m   ON m.agency_id       = org.agency_id
      WHERE p.id   = auth.uid()
        AND p.role = 'agent'
        AND m.id   = model_embeddings.model_id
    )
    OR
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles           p
      JOIN public.organization_members om  ON om.user_id        = p.id
      JOIN public.organizations        org ON org.id            = om.organization_id
                                          AND org.type          = 'agency'
      JOIN public.models               m   ON m.agency_id       = org.agency_id
      WHERE p.id   = auth.uid()
        AND p.role = 'agent'
        AND m.id   = model_embeddings.model_id
    )
    OR
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );

-- ─── Verification ─────────────────────────────────────────────────────────────
-- SELECT policyname, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename  = 'model_embeddings'
-- ORDER BY policyname;
-- Expected: "Agency can upsert own model embeddings" (ALL) + "Embeddings readable scoped" (SELECT)
