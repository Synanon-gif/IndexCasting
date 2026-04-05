-- ============================================================================
-- model_embeddings Policies — Finalize (anti-regression lock)
-- 2026-04-11
--
-- PROBLEM (Migration Ordering):
--   20260405_risk_hardening_secdef_orgfilter.sql  (prefix 'r') runs BEFORE
--   20260405_security_three_dangers_fix.sql        (prefix 's') alphabetically.
--
--   security_three_dangers_fix.sql re-creates "Agency can upsert own model
--   embeddings" as FOR ALL with a raw profiles→organization_members→models JOIN
--   in USING. This undoes the correct policy split on a fresh deploy.
--
--   This migration runs after all 20260405–20260410 migrations (prefix '20260411')
--   and sets the definitive, recursion-safe policy state.
--
-- GOAL:
--   - No FOR ALL policy on model_embeddings (eliminates future 42P17 risk)
--   - No raw JOIN on profiles in USING clauses
--   - All access via check_org_access() (SECURITY DEFINER, row_security=off)
--   - Admin always has access via is_current_user_admin()
--
-- ADMIN_UUID:  fb0ab854-d0c3-4e09-a39c-269d60246927
-- ADMIN_EMAIL: rubenelge@t-online.de
-- ============================================================================

-- Drop ALL existing model_embeddings policies (safe: idempotent re-create below)
DROP POLICY IF EXISTS "Agency can upsert own model embeddings" ON public.model_embeddings;
DROP POLICY IF EXISTS "Embeddings readable scoped"             ON public.model_embeddings;
DROP POLICY IF EXISTS "model_embeddings_select"                ON public.model_embeddings;
DROP POLICY IF EXISTS "model_embeddings_insert"                ON public.model_embeddings;
DROP POLICY IF EXISTS "model_embeddings_update"                ON public.model_embeddings;
DROP POLICY IF EXISTS "model_embeddings_delete"                ON public.model_embeddings;

-- ── SELECT ───────────────────────────────────────────────────────────────────
-- Admin + agency members (via check_org_access, NO profiles JOIN) + clients.
-- check_org_access() is SECURITY DEFINER with SET row_security TO off —
-- does not trigger RLS on organization_members or models.

CREATE POLICY "model_embeddings_select"
  ON public.model_embeddings
  FOR SELECT TO authenticated
  USING (
    public.is_current_user_admin()
    OR public.check_org_access(
         (SELECT org.id
          FROM   public.organizations org
          JOIN   public.models        m  ON m.agency_id = org.agency_id
          WHERE  m.id   = model_embeddings.model_id
            AND  org.type = 'agency'
          LIMIT 1),
         'agency'::organization_type,
         ARRAY['owner','booker','employee']::org_member_role[]
       )
    OR EXISTS (
         SELECT 1
         FROM   public.organization_members om
         JOIN   public.organizations        o ON o.id = om.organization_id
         WHERE  om.user_id = auth.uid()
           AND  o.type     = 'client'
       )
  );

-- ── INSERT ───────────────────────────────────────────────────────────────────
CREATE POLICY "model_embeddings_insert"
  ON public.model_embeddings
  FOR INSERT TO authenticated
  WITH CHECK (
    public.check_org_access(
         (SELECT org.id
          FROM   public.organizations org
          JOIN   public.models        m  ON m.agency_id = org.agency_id
          WHERE  m.id   = model_embeddings.model_id
            AND  org.type = 'agency'
          LIMIT 1),
         'agency'::organization_type,
         ARRAY['owner','booker','employee']::org_member_role[]
       )
    OR public.is_current_user_admin()
  );

-- ── UPDATE ───────────────────────────────────────────────────────────────────
CREATE POLICY "model_embeddings_update"
  ON public.model_embeddings
  FOR UPDATE TO authenticated
  USING (
    public.check_org_access(
         (SELECT org.id
          FROM   public.organizations org
          JOIN   public.models        m  ON m.agency_id = org.agency_id
          WHERE  m.id   = model_embeddings.model_id
            AND  org.type = 'agency'
          LIMIT 1),
         'agency'::organization_type,
         ARRAY['owner','booker','employee']::org_member_role[]
       )
    OR public.is_current_user_admin()
  )
  WITH CHECK (
    public.check_org_access(
         (SELECT org.id
          FROM   public.organizations org
          JOIN   public.models        m  ON m.agency_id = org.agency_id
          WHERE  m.id   = model_embeddings.model_id
            AND  org.type = 'agency'
          LIMIT 1),
         'agency'::organization_type,
         ARRAY['owner','booker','employee']::org_member_role[]
       )
    OR public.is_current_user_admin()
  );

-- ── DELETE ───────────────────────────────────────────────────────────────────
CREATE POLICY "model_embeddings_delete"
  ON public.model_embeddings
  FOR DELETE TO authenticated
  USING (
    public.check_org_access(
         (SELECT org.id
          FROM   public.organizations org
          JOIN   public.models        m  ON m.agency_id = org.agency_id
          WHERE  m.id   = model_embeddings.model_id
            AND  org.type = 'agency'
          LIMIT 1),
         'agency'::organization_type,
         ARRAY['owner','booker','employee']::org_member_role[]
       )
    OR public.is_current_user_admin()
  );

-- ── Verification ─────────────────────────────────────────────────────────────
-- After deploy, run:
--
--   SELECT policyname, cmd FROM pg_policies
--   WHERE tablename = 'model_embeddings' ORDER BY cmd;
--   → Must return exactly 4 rows: DELETE, INSERT, SELECT, UPDATE
--   → Must NOT contain cmd = 'ALL'
