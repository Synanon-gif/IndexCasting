-- =============================================================================
-- Admin Org RLS + Full B2B Backfill
--
-- Fixes two issues:
--   1. Admin can only see own org via direct table query (missing admin SELECT RLS)
--   2. Agents without an agencies row were skipped in the original backfill
--      (the INNER JOIN on email produced no rows)
--
-- Idempotent — safe to run multiple times.
-- Run in Supabase Dashboard → SQL Editor.
-- =============================================================================

-- ─── 1. Admin SELECT RLS: organizations ──────────────────────────────────────
-- Without this, the TS fallback (direct .from('organizations').select())
-- only returns orgs where the admin is a member (= 1 org).

DROP POLICY IF EXISTS "admin_select_all_organizations" ON public.organizations;
CREATE POLICY "admin_select_all_organizations"
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_admin = TRUE
    )
  );

-- ─── 2. Admin SELECT RLS: organization_members ───────────────────────────────
-- Same issue: admin expanding an org card needs to see all members.

DROP POLICY IF EXISTS "admin_select_all_org_members" ON public.organization_members;
CREATE POLICY "admin_select_all_org_members"
  ON public.organization_members
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_admin = TRUE
    )
  );

-- ─── 3. Ensure agencies rows for agent profiles that have none ────────────────
-- The original backfill used INNER JOIN agencies → profiles by email.
-- If an agent never triggered ensure_agency_for_current_agent (broken bootstrap),
-- they had no agencies row and the JOIN produced nothing.

INSERT INTO public.agencies (name, email, code)
SELECT
  COALESCE(NULLIF(trim(p.company_name), ''), 'Agency'),
  lower(trim(p.email)),
  'a' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15)
FROM public.profiles p
WHERE p.role::text = 'agent'
  AND p.email IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.agencies a
    WHERE lower(trim(a.email)) = lower(trim(p.email))
  );

-- ─── 4. Agency organizations ─────────────────────────────────────────────────

INSERT INTO public.organizations (name, type, owner_id, agency_id)
SELECT DISTINCT ON (a.id)
  COALESCE(NULLIF(trim(a.name), ''), 'Agency'),
  'agency'::public.organization_type,
  p.id,
  a.id
FROM public.agencies a
INNER JOIN public.profiles p
  ON lower(trim(COALESCE(p.email, ''))) = lower(trim(COALESCE(a.email, '')))
  AND p.role::text = 'agent'
WHERE NOT EXISTS (
  SELECT 1 FROM public.organizations o WHERE o.agency_id = a.id
)
ORDER BY a.id, p.created_at ASC NULLS LAST;

-- ─── 5. Client organizations ─────────────────────────────────────────────────

INSERT INTO public.organizations (name, type, owner_id, agency_id)
SELECT
  COALESCE(NULLIF(trim(p.company_name), ''), 'My Organization'),
  'client'::public.organization_type,
  p.id,
  NULL
FROM public.profiles p
WHERE p.role::text = 'client'
  AND NOT EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.owner_id = p.id
      AND o.type = 'client'
  );

-- ─── 6. Owner membership rows for orgs without an owner member ───────────────

INSERT INTO public.organization_members (user_id, organization_id, role)
SELECT o.owner_id, o.id, 'owner'::public.org_member_role
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.organization_members m
  WHERE m.organization_id = o.id
    AND m.role::text = 'owner'
);

-- ─── 7. Verification ─────────────────────────────────────────────────────────
-- Run these selects after to confirm 0 orphaned B2B profiles remain.
--
-- SELECT p.email, p.display_name, p.role FROM profiles p
-- WHERE p.role IN ('client', 'agent')
--   AND p.is_guest IS DISTINCT FROM true
--   AND NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id = p.id);
--
-- SELECT COUNT(*) FROM organizations;
