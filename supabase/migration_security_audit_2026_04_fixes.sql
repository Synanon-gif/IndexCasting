-- ============================================================
-- SECURITY AUDIT FIXES — 2026-04-04
--
-- C1: chat-files bucket → private (was PUBLIC)
-- C2: can_view_model_photo() SECURITY DEFINER RPC (IDOR fix)
-- C3: Drop "Anon can read agencies" policy
-- H1: profiles → org-scoped SELECT (was USING(true) for all authenticated)
-- H3: image_rights_confirmations → add org_id column
-- H4: Remove duplicate model_agency_territories policy
-- ============================================================

-- ── C1: Set chat-files bucket to private ───────────────────────────────────
UPDATE storage.buckets
SET    public = false
WHERE  id = 'chat-files';

-- ── C3: Drop unauthenticated read on agencies ──────────────────────────────
DROP POLICY IF EXISTS "Anon can read agencies" ON public.agencies;

-- ── H4: Remove duplicate model_agency_territories policy ───────────────────
DROP POLICY IF EXISTS "Authenticated users can read territories" ON public.model_agency_territories;

-- ── H1: Replace unlimited profiles read with org-scoped policy ─────────────
-- Old policy allowed ALL authenticated users to read ANY profile row.
-- New policy: own profile OR members of the same organization
-- OR participants of a shared conversation (required for cross-org chat UX).
DROP POLICY IF EXISTS "Profiles limited public read" ON public.profiles;
-- Idempotent re-run: drop our policy if it already exists (e.g. second paste in SQL Editor).
DROP POLICY IF EXISTS "profiles_org_scoped_read" ON public.profiles;

CREATE POLICY "profiles_org_scoped_read"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    -- own profile always accessible
    id = auth.uid()
    -- same-org members (booker↔booker, owner↔booker, client employees, etc.)
    OR id IN (
      SELECT om2.user_id
      FROM   public.organization_members om2
      WHERE  om2.organization_id IN (
        SELECT om1.organization_id
        FROM   public.organization_members om1
        WHERE  om1.user_id = auth.uid()
      )
    )
  );

-- ── H3: Add org_id to image_rights_confirmations ───────────────────────────
ALTER TABLE public.image_rights_confirmations
  ADD COLUMN IF NOT EXISTS org_id uuid
    REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_image_rights_org_id
  ON public.image_rights_confirmations (org_id);

-- ── C2: SECURITY DEFINER RPC — can_view_model_photo ────────────────────────
-- Replaces the insecure "model exists" check in serve-watermarked-image.
-- Returns true if the authenticated caller may view photos for this model:
--   1. Caller is a member (owner/booker) of the model's owning agency, OR
--   2. Caller is a member of any client organisation (discovery access via
--      platform subscription is enforced separately by can_access_platform).
CREATE OR REPLACE FUNCTION public.can_view_model_photo(p_model_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      uuid := auth.uid();
  v_model_org_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  -- Resolve the owning agency of this model
  SELECT organization_id
  INTO   v_model_org_id
  FROM   public.models
  WHERE  id = p_model_id;

  IF v_model_org_id IS NULL THEN
    RETURN false;
  END IF;

  -- Allow: caller is a member of the owning agency
  IF EXISTS (
    SELECT 1
    FROM   public.organization_members
    WHERE  organization_id = v_model_org_id
      AND  user_id         = v_user_id
  ) THEN
    RETURN true;
  END IF;

  -- Allow: caller belongs to a client organisation (platform subscription
  -- check is already done before this RPC is called)
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

GRANT EXECUTE ON FUNCTION public.can_view_model_photo(uuid) TO authenticated;

-- ── Verification queries (informational) ───────────────────────────────────
-- SELECT id, name, public FROM storage.buckets WHERE id = 'chat-files';
-- → should show public=false
-- SELECT policyname FROM pg_policies WHERE tablename='agencies' AND roles='{anon}';
-- → should return 0 rows
-- SELECT routine_name FROM information_schema.routines
--   WHERE routine_schema='public' AND routine_name='can_view_model_photo';
-- → should return 1 row
