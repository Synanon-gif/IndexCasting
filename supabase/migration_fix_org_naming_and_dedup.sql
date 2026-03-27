-- =============================================================================
-- Org Deduplication & Naming Fix  (v2 – handles ALL duplicate cases)
--
-- Root cause: ensure_agency_for_current_agent() fell back to display_name when
-- company_name was empty, creating an agencies row (and linked org) named after
-- the person (e.g. "Ruben Johannes Elge") even when the user later renamed the
-- agency (e.g. "Poetry Of People"), resulting in TWO agency orgs for the same
-- owner — both with agency_id IS NOT NULL pointing to different agencies rows.
--
-- v1 only caught orphans (agency_id IS NULL). v2 uses a priority-based canonical
-- selection: for each owner keep the org whose name ≠ owner's display_name
-- (proper business name wins); tie-break by created_at (oldest survives).
--
-- This migration:
--   1. Moves members from non-canonical agency orgs → canonical, deletes rest.
--   2. Defensively deduplicates client orgs (keeps oldest).
--   3. Adds UNIQUE (owner_id) WHERE type='agency' to block future duplicates.
--   4. Fixes ensure_agency_for_current_agent(): no display_name fallback.
--   5. Fixes ensure_client_organization(): no display_name fallback.
--   6. Syncs organizations.name from linked agencies.name where they differ.
-- =============================================================================

-- ─── 1. Agency org dedup ──────────────────────────────────────────────────────
--
-- For every owner that has MORE THAN ONE agency org we:
--   a) identify the "canonical" org:
--        priority-1: org whose name ≠ owner's display_name (business name wins)
--        priority-2: oldest (created_at ASC)
--   b) move all members from every non-canonical org into the canonical one
--   c) delete every non-canonical org
--
-- This handles:
--   • both orgs have agency_id IS NOT NULL   (new duplicate pattern)
--   • one has agency_id IS NULL              (old orphan pattern)
--   • any mix of the above

-- 1a. Move members of non-canonical orgs to the canonical org for the same owner.
INSERT INTO public.organization_members (user_id, organization_id, role)
SELECT DISTINCT
  om.user_id,
  canonical.id   AS organization_id,
  om.role
FROM   public.organizations dup
JOIN   public.profiles       p         ON p.id  = dup.owner_id
JOIN   public.organization_members om ON om.organization_id = dup.id
-- Find the single canonical org for this owner
JOIN   LATERAL (
    SELECT o.id
    FROM   public.organizations o
    WHERE  o.owner_id = dup.owner_id
      AND  o.type     = 'agency'
    ORDER BY
      -- prefer name ≠ display_name  (0 = keep,  1 = discard)
      (CASE WHEN lower(trim(o.name)) = lower(trim(p.display_name)) THEN 1 ELSE 0 END),
      o.created_at ASC
    LIMIT 1
) canonical ON canonical.id <> dup.id
WHERE  dup.type = 'agency'
  -- only act on owners with multiple agency orgs
  AND  (SELECT COUNT(*) FROM public.organizations o2
        WHERE o2.owner_id = dup.owner_id AND o2.type = 'agency') > 1
ON CONFLICT (user_id, organization_id) DO NOTHING;

-- 1b. Delete every non-canonical agency org.
DELETE FROM public.organizations dup
USING  public.profiles p
WHERE  dup.owner_id = p.id
  AND  dup.type     = 'agency'
  -- owner has more than one agency org
  AND  (SELECT COUNT(*) FROM public.organizations o2
        WHERE o2.owner_id = dup.owner_id AND o2.type = 'agency') > 1
  -- this row is NOT the canonical one
  AND  dup.id <> (
      SELECT o.id
      FROM   public.organizations o
      WHERE  o.owner_id = dup.owner_id
        AND  o.type     = 'agency'
      ORDER BY
        (CASE WHEN lower(trim(o.name)) = lower(trim(p.display_name)) THEN 1 ELSE 0 END),
        o.created_at ASC
      LIMIT 1
  );

-- ─── 2. Client dedup with business-name priority ─────────────────────────────
--
-- Same logic as agency dedup:
--   priority-1: org whose name ≠ owner's display_name (business name wins)
--   priority-2: oldest (created_at ASC)
-- This ensures ghost-orgs named after the person are removed even when they
-- were created first (bootstrap), and the proper business-name org survives.

-- 2a. Move members from non-canonical client orgs to the canonical one.
INSERT INTO public.organization_members (user_id, organization_id, role)
SELECT DISTINCT
  om.user_id,
  canonical.id AS organization_id,
  om.role
FROM   public.organizations dup
JOIN   public.profiles       p         ON p.id  = dup.owner_id
JOIN   public.organization_members om ON om.organization_id = dup.id
JOIN   LATERAL (
    SELECT o.id
    FROM   public.organizations o
    WHERE  o.owner_id = dup.owner_id
      AND  o.type     = 'client'
    ORDER BY
      -- prefer name ≠ display_name  (0 = keep,  1 = discard)
      (CASE WHEN lower(trim(o.name)) = lower(trim(p.display_name)) THEN 1 ELSE 0 END),
      o.created_at ASC
    LIMIT 1
) canonical ON canonical.id <> dup.id
WHERE  dup.type = 'client'
  AND  (SELECT COUNT(*) FROM public.organizations o2
        WHERE o2.owner_id = dup.owner_id AND o2.type = 'client') > 1
ON CONFLICT (user_id, organization_id) DO NOTHING;

-- 2b. Delete every non-canonical client org.
DELETE FROM public.organizations dup
USING  public.profiles p
WHERE  dup.owner_id = p.id
  AND  dup.type     = 'client'
  AND  (SELECT COUNT(*) FROM public.organizations o2
        WHERE o2.owner_id = dup.owner_id AND o2.type = 'client') > 1
  AND  dup.id <> (
      SELECT o.id
      FROM   public.organizations o
      WHERE  o.owner_id = dup.owner_id
        AND  o.type     = 'client'
      ORDER BY
        (CASE WHEN lower(trim(o.name)) = lower(trim(p.display_name)) THEN 1 ELSE 0 END),
        o.created_at ASC
      LIMIT 1
  );

-- ─── 3. UNIQUE constraints: one agency org + one client org per owner ────────
-- Safe to add now — duplicates removed in steps 1 and 2.

CREATE UNIQUE INDEX IF NOT EXISTS organizations_one_agency_owner
  ON public.organizations (owner_id)
  WHERE type = 'agency';

CREATE UNIQUE INDEX IF NOT EXISTS organizations_one_client_owner
  ON public.organizations (owner_id)
  WHERE type = 'client';

-- ─── 4. Fix ensure_agency_for_current_agent(): remove display_name fallback ───

CREATE OR REPLACE FUNCTION public.ensure_agency_for_current_agent()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  aid      uuid;
  pem      text;
  ag_name  text;
  new_code text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF (SELECT p.role::text FROM public.profiles p WHERE p.id = auth.uid()) IS DISTINCT FROM 'agent' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT
    trim(COALESCE(p.email, '')),
    -- Only use company_name; never fall back to personal display_name.
    COALESCE(NULLIF(trim(p.company_name), ''), 'Agency')
  INTO pem, ag_name
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF pem IS NULL OR pem = '' THEN
    RAISE EXCEPTION 'profile email required';
  END IF;

  SELECT a.id INTO aid
  FROM   public.agencies a
  WHERE  lower(trim(a.email)) = lower(trim(pem))
  LIMIT  1;
  IF aid IS NOT NULL THEN
    RETURN aid;
  END IF;

  new_code := 'a' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15);

  INSERT INTO public.agencies (name, email, code)
  VALUES (ag_name, pem, new_code)
  RETURNING id INTO aid;

  RETURN aid;
END;
$$;

REVOKE ALL    ON FUNCTION public.ensure_agency_for_current_agent() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_agency_for_current_agent() TO authenticated;

COMMENT ON FUNCTION public.ensure_agency_for_current_agent() IS
  'Creates an agencies row for the current agent profile email if missing. '
  'Name comes from company_name only (never falls back to display_name).';

-- ─── 5. Fix ensure_client_organization(): remove display_name fallback ─────────

CREATE OR REPLACE FUNCTION public.ensure_client_organization()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  oid   uuid;
  oname text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'client' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT o.id INTO oid
  FROM   public.organizations o
  WHERE  o.owner_id = auth.uid() AND o.type = 'client'
  LIMIT  1;
  IF oid IS NOT NULL THEN
    RETURN oid;
  END IF;

  -- Only use company_name; never fall back to personal display_name.
  SELECT COALESCE(NULLIF(trim(company_name), ''), 'My Organization')
  INTO oname
  FROM public.profiles
  WHERE id = auth.uid();

  INSERT INTO public.organizations (name, type, owner_id, agency_id)
  VALUES (oname, 'client', auth.uid(), NULL)
  RETURNING id INTO oid;

  INSERT INTO public.organization_members (user_id, organization_id, role)
  VALUES (auth.uid(), oid, 'owner');

  RETURN oid;
END;
$$;

REVOKE ALL    ON FUNCTION public.ensure_client_organization() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_client_organization() TO authenticated;

COMMENT ON FUNCTION public.ensure_client_organization() IS
  'Creates a client organization for the current user if none exists. '
  'Name comes from company_name only (never falls back to display_name).';

-- ─── 6. Sync organizations.name from linked agencies.name ────────────────────
-- After dedup the surviving org may still carry the old personal name while the
-- linked agencies row already has the correct business name (user renamed it via
-- agency settings). Update org name to match.

UPDATE public.organizations o
SET    name = a.name
FROM   public.agencies a
WHERE  o.agency_id = a.id
  AND  o.name IS DISTINCT FROM a.name
  AND  a.name NOT IN ('Agency', 'Agency workspace', 'My Agency');
