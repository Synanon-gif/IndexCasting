-- =============================================================================
-- DEPRECATED / DO NOT EXECUTE — DIAGNOSE ONLY (NOT DEPLOYED via supabase CLI)
--
-- This file lives outside `supabase/migrations/` and is NOT auto-deployed.
-- Canonical, deployed sources of truth live in `supabase/migrations/YYYYMMDD_*.sql`.
-- Manual execution can introduce silent regressions on the live DB
-- (RLS recursion, weakened SECURITY DEFINER guards, broken admin access, etc.).
--
-- See: `.cursor/rules/system-invariants.mdc` (LIVE-DB SOURCE OF TRUTH),
--      `docs/LIVE_DB_DRIFT_GUARDRAIL.md`,
--      `docs/CONSISTENCY_FLOW_CHECK_2026-04-19.md` (Cluster F).
--
-- If you need to apply changes, create a new dated migration in `supabase/migrations/`.
-- =============================================================================

-- =============================================================================
-- Restrict model_embeddings RLS: only agency (agent) and client users may read.
-- Previously: all authenticated users — including models — could read all
-- embeddings, which exposes similarity data across the entire model pool.
--
-- match_models() is SECURITY DEFINER so it bypasses this policy internally;
-- direct SELECT on the table is now restricted to agent/client roles only.
-- =============================================================================

-- Drop the overly broad existing policy
DROP POLICY IF EXISTS "Embeddings readable by authenticated" ON public.model_embeddings;

-- New scoped policy: only agent and client profile roles may read embeddings
CREATE POLICY "Embeddings readable by agency and client"
  ON public.model_embeddings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('agent', 'client')
    )
    OR
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.is_admin = true
    )
  );

-- Upsert (write) remains restricted to agency members who manage the model
-- Drop existing permissive write policy if present from phase9
DROP POLICY IF EXISTS "Embeddings upsert own model" ON public.model_embeddings;

CREATE POLICY "Agency can upsert own model embeddings"
  ON public.model_embeddings
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE m.id = model_embeddings.model_id
        AND m.agency_id IS NOT NULL
        AND p.role = 'agent'
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
      FROM public.models m
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE m.id = model_embeddings.model_id
        AND m.agency_id IS NOT NULL
        AND p.role = 'agent'
    )
    OR
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );
