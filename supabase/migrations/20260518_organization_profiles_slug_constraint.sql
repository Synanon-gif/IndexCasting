-- ============================================================================
-- Organization Profiles — Slug Format Constraint
-- 2026-05-18
--
-- Adds a CHECK constraint on organization_profiles.slug to enforce that
-- slugs only contain lowercase letters, digits, and hyphens, and that they
-- do not start or end with a hyphen.
--
-- The UNIQUE constraint on slug already exists from the foundation migration
-- (20260513_organization_profiles_foundation.sql). This migration only adds
-- the format guard as defense-in-depth — the primary validation happens in
-- the frontend via validateSlug() in src/utils/orgProfilePublicSettings.ts.
--
-- Safety:
--   - Idempotent: uses DO...EXCEPTION WHEN duplicate_object to skip if exists
--   - Non-breaking: existing slug values are either NULL (exempt by CHECK) or
--     must already conform if set by the new UI
--   - Does not add another UNIQUE index (already enforced by table definition)
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE public.organization_profiles
    ADD CONSTRAINT organization_profiles_slug_format
    CHECK (
      slug IS NULL
      OR (
        -- Single char: only a-z or 0-9
        slug ~ '^[a-z0-9]$'
        -- Multi-char: starts and ends with a-z/0-9, middle allows hyphens
        OR slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'
      )
    );
EXCEPTION WHEN duplicate_object THEN
  NULL; -- constraint already exists — safe no-op
END $$;

-- ── Post-deploy verification ──────────────────────────────────────────────────
--
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.organization_profiles'::regclass
--   AND conname = 'organization_profiles_slug_format';
-- -- Expected: 1 row with the CHECK expression above
