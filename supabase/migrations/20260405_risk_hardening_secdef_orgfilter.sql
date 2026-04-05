-- ============================================================================
-- Risk Hardening: SECURITY DEFINER + row_security + model_embeddings FOR ALL
-- 2026-04-05
--
-- RISIKO 3: SECURITY DEFINER Funktionen ohne SET row_security TO off
--   Jede SECURITY DEFINER Funktion die aus einer RLS-Policy aufgerufen wird
--   oder RLS-geschützte Tabellen liest, MUSS SET row_security TO off haben.
--   Ohne dies kann PostgreSQL beim Auflösen von Policies Zyklen erkennen oder
--   leere Ergebnisse liefern (latente 42P17 / Bug-Gefahr).
--
--   Betroffen:
--     is_org_member()             — aus booking_events SELECT+UPDATE Policies
--     can_view_model_photo()      — aus Storage-Bucket Policies, liest models
--     agency_can_manage_recruiting_for_agency() — liest profiles via email-match
--
-- RISIKO 2: model_embeddings FOR ALL mit profiles+models Referenz
--   FOR ALL Policies schließen SELECT ein. Eine Policy auf model_embeddings
--   die profiles+models in USING liest kann theoretisch Rekursion auslösen wenn
--   eine der referenzierten Tabellen jemals model_embeddings zurückverlinkt.
--   Lösung: Aufsplitten in separaten SELECT + INSERT/UPDATE/DELETE Guards.
--
-- ADMIN_UUID:  fb0ab854-d0c3-4e09-a39c-269d60246927
-- ADMIN_EMAIL: rubenelge@t-online.de
-- ============================================================================

-- ── RISIKO 3a: is_org_member — SET row_security TO off ───────────────────────
--
-- Called from: booking_events_select, booking_events_update policies.
-- Reads: organization_members (has RLS), organizations (has RLS).
-- Without row_security=off: PostgreSQL evaluates org_members RLS inside this
-- function, which calls check_org_access() (has row_security=off) → safe for
-- now, but any future change to org_members policies could create a cycle.

CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = p_org_id
      AND om.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_org_id
      AND o.owner_id = auth.uid()
  );
$$;

REVOKE ALL    ON FUNCTION public.is_org_member(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;

COMMENT ON FUNCTION public.is_org_member IS
  'Returns true if the current user is a member or owner of the given org. '
  'SECURITY DEFINER with row_security=off to prevent RLS cycles when called from policies.';


-- ── RISIKO 3b: can_view_model_photo — SET row_security TO off ────────────────
--
-- Called from: Storage-Bucket RLS policies.
-- Reads: models (has RLS), organization_members (has RLS).
-- Without row_security=off: models SELECT triggers models RLS evaluation,
-- which can join organization_members — creating a double-eval chain.

CREATE OR REPLACE FUNCTION public.can_view_model_photo(p_model_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_user_id      uuid := auth.uid();
  v_model_org_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  -- Resolve the owning agency org of this model (bypasses models RLS via row_security=off)
  SELECT organization_id
  INTO   v_model_org_id
  FROM   public.models
  WHERE  id = p_model_id;

  IF v_model_org_id IS NULL THEN
    RETURN false;
  END IF;

  -- Allow: caller is a member of the owning agency org
  IF EXISTS (
    SELECT 1
    FROM   public.organization_members
    WHERE  organization_id = v_model_org_id
      AND  user_id         = v_user_id
  ) THEN
    RETURN true;
  END IF;

  -- Allow: caller belongs to a client organisation
  IF EXISTS (
    SELECT 1
    FROM   public.organization_members om
    JOIN   public.organizations        o  ON o.id = om.organization_id
    WHERE  om.user_id = v_user_id
      AND  o.type     = 'client'
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL    ON FUNCTION public.can_view_model_photo(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_view_model_photo(uuid) TO authenticated, anon;

COMMENT ON FUNCTION public.can_view_model_photo IS
  'Returns true if auth.uid() may view a photo for the given model. '
  'SECURITY DEFINER with row_security=off: reads models and organization_members '
  'directly without triggering their RLS policies (prevents eval chains from storage policies).';


-- ── RISIKO 3c: agency_can_manage_recruiting_for_agency — fix email match ─────
--
-- PROBLEM: Contains a JOIN profiles ON email = agency.email (Danger-2 pattern).
-- This is the same forbidden email-matching pattern removed from RLS policies.
-- It also reads profiles without row_security=off while potentially called from
-- a security context. Fix: remove email branch, rely only on org-membership
-- (get_my_agency_member_role uses SECURITY DEFINER properly).

CREATE OR REPLACE FUNCTION public.agency_can_manage_recruiting_for_agency(p_agency_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  -- Org-membership check only — no email matching.
  -- get_my_agency_member_role() is a SECURITY DEFINER RPC that verifies
  -- the caller's membership in the agency's organisation.
  SELECT EXISTS (
    SELECT 1
    FROM public.get_my_agency_member_role(p_agency_id)
  );
$$;

REVOKE ALL    ON FUNCTION public.agency_can_manage_recruiting_for_agency(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agency_can_manage_recruiting_for_agency(uuid) TO authenticated;

COMMENT ON FUNCTION public.agency_can_manage_recruiting_for_agency IS
  'Returns true if the current user is a member of the given agency org. '
  'Email-match branch removed (Danger-2 pattern). Uses get_my_agency_member_role '
  '(SECURITY DEFINER) exclusively. row_security=off prevents profile eval chains.';


-- ── RISIKO 2: model_embeddings FOR ALL → SELECT + write guard ────────────────
--
-- The FOR ALL policy "Agency can upsert own model embeddings" includes SELECT.
-- It joins profiles and models in USING. While not currently recursive
-- (models SELECT does not reference model_embeddings), a future policy change
-- on models that references model_embeddings would immediately create 42P17.
-- Solution: split SELECT and write access into separate policies using
-- check_org_access() (SECURITY DEFINER, row_security=off) instead of
-- raw profiles joins.

-- Drop the unsafe FOR ALL policy and the "Embeddings readable scoped" SELECT policy
DROP POLICY IF EXISTS "Agency can upsert own model embeddings" ON public.model_embeddings;
DROP POLICY IF EXISTS "Embeddings readable scoped"             ON public.model_embeddings;

-- SELECT: admin + agency members (via check_org_access, no profiles join) + clients
CREATE POLICY "model_embeddings_select"
  ON public.model_embeddings
  FOR SELECT TO authenticated
  USING (
    public.is_current_user_admin()
    OR public.check_org_access(
         (SELECT org.id
          FROM   public.organizations org
          JOIN   public.models m ON m.agency_id = org.agency_id
          WHERE  m.id = model_embeddings.model_id
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

-- INSERT: agency members only (same org check, write-only)
CREATE POLICY "model_embeddings_insert"
  ON public.model_embeddings
  FOR INSERT TO authenticated
  WITH CHECK (
    public.check_org_access(
         (SELECT org.id
          FROM   public.organizations org
          JOIN   public.models m ON m.agency_id = org.agency_id
          WHERE  m.id = model_embeddings.model_id
            AND  org.type = 'agency'
          LIMIT 1),
         'agency'::organization_type,
         ARRAY['owner','booker','employee']::org_member_role[]
       )
    OR public.is_current_user_admin()
  );

-- UPDATE: agency members only
CREATE POLICY "model_embeddings_update"
  ON public.model_embeddings
  FOR UPDATE TO authenticated
  USING (
    public.check_org_access(
         (SELECT org.id
          FROM   public.organizations org
          JOIN   public.models m ON m.agency_id = org.agency_id
          WHERE  m.id = model_embeddings.model_id
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
          JOIN   public.models m ON m.agency_id = org.agency_id
          WHERE  m.id = model_embeddings.model_id
            AND  org.type = 'agency'
          LIMIT 1),
         'agency'::organization_type,
         ARRAY['owner','booker','employee']::org_member_role[]
       )
    OR public.is_current_user_admin()
  );

-- DELETE: agency members only
CREATE POLICY "model_embeddings_delete"
  ON public.model_embeddings
  FOR DELETE TO authenticated
  USING (
    public.check_org_access(
         (SELECT org.id
          FROM   public.organizations org
          JOIN   public.models m ON m.agency_id = org.agency_id
          WHERE  m.id = model_embeddings.model_id
            AND  org.type = 'agency'
          LIMIT 1),
         'agency'::organization_type,
         ARRAY['owner','booker','employee']::org_member_role[]
       )
    OR public.is_current_user_admin()
  );


-- ── Verifikation (nach Deployment manuell ausführen) ─────────────────────────
--
-- 1. is_org_member hat row_security=off:
--    SELECT proname, proconfig FROM pg_proc
--    WHERE proname = 'is_org_member' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='public');
--    → proconfig muss 'row_security=off' enthalten
--
-- 2. model_embeddings hat kein FOR ALL mit profiles/models Referenz mehr:
--    SELECT policyname, cmd FROM pg_policies
--    WHERE tablename = 'model_embeddings' AND cmd = 'ALL';
--    → 0 Zeilen erwartet
--
-- 3. agency_can_manage_recruiting_for_agency hat kein email-Match:
--    SELECT prosrc FROM pg_proc WHERE proname = 'agency_can_manage_recruiting_for_agency'
--    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='public');
--    → kein 'email' im Quellcode
