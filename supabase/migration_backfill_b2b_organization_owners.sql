-- Backfill organizations + owner membership for legacy accounts (created before org
-- migrations or never triggered ensure_agency_organization / ensure_client_organization).
--
-- Rules (aligned with RPCs):
-- - Agency: one organizations row per agencies.id; owner = profile where role = agent
--   and lower(trim(email)) matches agencies.email.
-- - Client: one client-type organizations row per client profile (owner_id = profile id);
--   only for profiles.role = client without such a row yet.
--
-- Idempotent: safe to re-run. Run in Supabase SQL Editor (postgres / service context).
--
-- Prerequisites: migration_organizations_invitations_rls.sql, migration_org_single_owner_invariant.sql

-- ---------------------------------------------------------------------------
-- 1) Agency orgs missing entirely
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 2) Client orgs for client profiles that never got an owner row
-- ---------------------------------------------------------------------------
INSERT INTO public.organizations (name, type, owner_id, agency_id)
SELECT
  COALESCE(NULLIF(trim(p.company_name), ''), NULLIF(trim(p.display_name), ''), 'Organization'),
  'client'::public.organization_type,
  p.id,
  NULL
FROM public.profiles p
WHERE p.role::text = 'client'
  AND NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.owner_id = p.id AND o.type = 'client'
  );

-- ---------------------------------------------------------------------------
-- 3) Owner membership rows (orgs without any owner member yet)
-- ---------------------------------------------------------------------------
INSERT INTO public.organization_members (user_id, organization_id, role)
SELECT o.owner_id, o.id, 'owner'::public.org_member_role
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1
  FROM public.organization_members m
  WHERE m.organization_id = o.id
    AND m.role::text = 'owner'
);
