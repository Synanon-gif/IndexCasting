-- =============================================================================
-- Repair org names that defaulted to 'My Organization' or 'Agency'
-- 2026-04-09
--
-- Existing organizations that were created before the handle_new_user trigger
-- captured company_name may have the generic fallback name.  Whenever
-- profiles.company_name now holds the real business name, sync it back to
-- organizations.name.
--
-- Safe conditions:
--   • Only touches rows where name IS the known fallback string.
--   • Only updates when profiles.company_name is non-null and non-empty.
--   • Does not touch agency orgs that have already been renamed via
--     AgencySettingsTab (those won't match the fallback string anymore).
-- =============================================================================

UPDATE public.organizations o
SET    name = trim(p.company_name)
FROM   public.profiles p
WHERE  o.owner_id = p.id
  AND  o.name IN ('My Organization', 'Agency')
  AND  NULLIF(trim(p.company_name), '') IS NOT NULL;

-- For agency orgs: also sync organizations.name from agencies.name when the
-- linked agencies row already has the correct business name and the org still
-- carries the fallback.  (Mirrors the sync in migration_fix_org_naming_and_dedup.sql
-- but scoped only to known-bad names so it is always safe to re-run.)
UPDATE public.organizations o
SET    name = a.name
FROM   public.agencies a
WHERE  o.agency_id   = a.id
  AND  o.name        IN ('My Organization', 'Agency')
  AND  a.name        NOT IN ('Agency', 'Agency workspace', 'My Agency', 'My Organization');

-- Verification:
-- SELECT id, name, type, owner_id FROM organizations WHERE name IN ('My Organization','Agency');
-- Expected: 0 rows (or only legitimate orgs that were intentionally named that).
-- =============================================================================
