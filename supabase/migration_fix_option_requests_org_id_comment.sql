-- =============================================================================
-- Documentation Fix: option_requests.organization_id semantics
--
-- Purpose (MED-5 from 2026-04 System Audit):
--   The column option_requests.organization_id has no comment explaining what
--   it represents. This led to a critical bug (CRIT-3) where notification
--   helpers treated it as the AGENCY org, when in reality it is the CLIENT org.
--
-- Semantics:
--   option_requests.organization_id = the CLIENT's organization ID.
--   It is populated by the client at INSERT time and used by RLS policies to
--   allow all members of the client's org to read/update the request.
--
--   It is NOT the agency org. To notify or create events for the agency side,
--   resolve the agency org via:
--     SELECT id FROM organizations WHERE agency_id = option_requests.agency_id
--
-- This migration adds a column comment to make this unambiguous for all
-- future contributors.
--
-- Run AFTER migration_phase14_options_jobs_castings.sql.
-- Listed in MIGRATION_ORDER.md Phase 27 (#136).
-- =============================================================================

COMMENT ON COLUMN public.option_requests.organization_id IS
  'The CLIENT organisation ID. Populated at INSERT by the client; used for client-side RLS scoping so all org members can read and update the request. This is NOT the agency org — to resolve the agency org use: SELECT id FROM organizations WHERE agency_id = option_requests.agency_id';
