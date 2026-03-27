-- =============================================================================
-- Enforce Single Organization per User
--
-- Business rule: every owner, booker, and employee can only belong to ONE
-- organization. Models are exempt — they are linked to agencies via the
-- `models` table / territory assignments and do NOT appear in
-- `organization_members` (the org_member_role enum has no 'model' value).
--
-- This migration:
--   1. Cleans up existing violations: for users with multiple memberships the
--      canonical membership is kept (priority: owner role first, then newest
--      created_at), all others are deleted.
--   2. Adds a UNIQUE (user_id) index to organization_members so the invariant
--      is enforced at the database level going forward.
--   3. Adds a check on accept_organization_invitation to block already-assigned
--      users (returns an error code the frontend can surface).
--
-- Idempotent — safe to run multiple times.
-- Run in Supabase Dashboard → SQL Editor.
-- =============================================================================

-- ─── 1. Remove duplicate memberships, keep canonical one per user ─────────────
--
-- Canonical = highest-priority role (owner > booker > employee), tie-break by
-- newest created_at (most recent membership survives).

DELETE FROM public.organization_members om
WHERE om.id <> (
  SELECT keep.id
  FROM public.organization_members keep
  WHERE keep.user_id = om.user_id
  ORDER BY
    -- role priority: owner=0 (keep), booker=1, employee=2
    CASE keep.role::text
      WHEN 'owner'    THEN 0
      WHEN 'booker'   THEN 1
      WHEN 'employee' THEN 2
      ELSE                 3
    END ASC,
    keep.created_at DESC
  LIMIT 1
)
AND (
  -- only act when more than one membership exists for this user
  SELECT COUNT(*) FROM public.organization_members x WHERE x.user_id = om.user_id
) > 1;

-- ─── 2. UNIQUE (user_id): one org membership per user ────────────────────────
-- Safe now that duplicates have been removed above.

CREATE UNIQUE INDEX IF NOT EXISTS org_members_one_org_per_user
  ON public.organization_members (user_id);

-- ─── 3. Guard in accept_organization_invitation ───────────────────────────────
-- If the invitee already belongs to an org, reject with a clear error so the
-- frontend can show "This user is already a member of another organization."

CREATE OR REPLACE FUNCTION public.accept_organization_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv     record;
  org_id  uuid;
  mem_cnt int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  -- Fetch the invitation
  SELECT * INTO inv
  FROM public.invitations
  WHERE token = p_token
    AND accepted_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1;

  IF inv IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_or_expired_token');
  END IF;

  org_id := inv.organization_id;

  -- Block if the accepting user already belongs to any other organization
  SELECT COUNT(*) INTO mem_cnt
  FROM public.organization_members
  WHERE user_id = auth.uid()
    AND organization_id <> org_id;

  IF mem_cnt > 0 THEN
    RETURN jsonb_build_object('error', 'already_member_of_another_org');
  END IF;

  -- Accept: mark invitation as used, upsert membership
  UPDATE public.invitations
  SET accepted_at = now(), accepted_by = auth.uid()
  WHERE id = inv.id;

  INSERT INTO public.organization_members (user_id, organization_id, role)
  VALUES (auth.uid(), org_id, COALESCE(inv.role, 'employee')::public.org_member_role)
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'organization_id', org_id);
END;
$$;

REVOKE ALL    ON FUNCTION public.accept_organization_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_organization_invitation(text) TO authenticated;

COMMENT ON FUNCTION public.accept_organization_invitation(text) IS
  'Accepts an org invitation by token. Returns error=already_member_of_another_org '
  'if the user already belongs to a different organization.';

-- ─── Verification ─────────────────────────────────────────────────────────────
-- Run these after migration to confirm no violations remain.
--
-- Users with more than one org membership (should return 0 rows):
-- SELECT user_id, COUNT(*) FROM organization_members GROUP BY user_id HAVING COUNT(*) > 1;
--
-- Total org memberships:
-- SELECT COUNT(*) FROM organization_members;
