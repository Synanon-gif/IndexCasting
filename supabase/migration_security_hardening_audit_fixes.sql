-- =============================================================================
-- Security Hardening: Audit Fixes
--
-- Fixes identified in the 2026-03 Full-Stack Security Audit:
--
--   SQL-01: bookings_select_scoped — org-member check unscoped (all org members
--           could read all bookings). Remove the overly-broad OR branch.
--
--   SQL-03: calendar_entries_write_agency — first WITH CHECK disjunction
--           `created_by_agency = true` acts as an INSERT bypass when the column
--           can be set by the caller. Remove; rely on EXISTS membership checks.
--
--   SQL-05: replication_slot_health VIEW — GRANT SELECT TO authenticated exposes
--           internal WAL / infra metadata to every logged-in user.
--           Revoke and restrict to service_role only.
--
--   DSGVO-01: security_events INSERT — org_id not validated against the
--             inserting user's actual memberships, allowing audit-log spoofing.
--
-- Run AFTER migration_security_events.sql AND
--             migration_request_workflow_hardening.sql.
-- =============================================================================


-- ─── SQL-01: Fix bookings_select_scoped ──────────────────────────────────────
--
-- The old policy contained:
--   OR EXISTS (
--     SELECT 1 FROM public.organization_members om
--     WHERE om.user_id = auth.uid()   -- ← no link to bookings.agency_id!
--   )
-- This allowed any user who belongs to ANY organisation to read every booking.
-- The correct agency-org-member check already exists in the policy (via
-- organizations JOIN organization_members WHERE o.agency_id = bookings.agency_id).
-- Remove the redundant, overly-broad branch.

DROP POLICY IF EXISTS "bookings_select_scoped" ON public.bookings;

CREATE POLICY "bookings_select_scoped"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (
    -- Direct client owner
    client_id = auth.uid()
    -- Agency member via bookers table (legacy path)
    OR EXISTS (
      SELECT 1 FROM public.bookers bk
      WHERE bk.agency_id = bookings.agency_id
        AND bk.user_id   = auth.uid()
    )
    -- Agency member via organizations + organization_members (invite path)
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.agency_id = bookings.agency_id
        AND om.user_id  = auth.uid()
    )
    -- Agency org owner
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.agency_id = bookings.agency_id
        AND o.owner_id  = auth.uid()
    )
  );


-- ─── SQL-03: Fix calendar_entries INSERT WITH CHECK bypass ────────────────────
--
-- The old INSERT policy had `created_by_agency = true` as its first disjunction.
-- Any authenticated user who POSTed `created_by_agency = true` in their INSERT
-- payload satisfied that condition without passing the agency-membership checks.
-- Fix: remove the bypass condition; require actual membership in all cases.

DROP POLICY IF EXISTS "calendar_entries_write_agency" ON public.calendar_entries;

CREATE POLICY "calendar_entries_write_agency"
  ON public.calendar_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.models m
      JOIN public.bookers bk ON bk.agency_id = m.agency_id
      WHERE m.id       = calendar_entries.model_id
        AND bk.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.id       = calendar_entries.model_id
        AND om.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      WHERE m.id       = calendar_entries.model_id
        AND o.owner_id = auth.uid()
    )
  );


-- ─── SQL-05: Restrict replication_slot_health to service_role only ────────────
--
-- The VIEW was readable by all `authenticated` users, exposing WAL-lag,
-- slot names, and DB infrastructure state. Revoke and allow only service_role.

REVOKE SELECT ON public.replication_slot_health FROM authenticated;
-- service_role bypasses RLS/grants — keep implicit service_role access.
-- If a specific monitoring role is used, grant it explicitly instead:
-- GRANT SELECT ON public.replication_slot_health TO monitoring_role;


-- ─── DSGVO-01: Scope security_events INSERT to user's own organisations ───────
--
-- The previous policy only checked user_id = auth.uid() but NOT that the
-- supplied org_id actually belongs to the inserting user. An attacker could
-- inject audit events with arbitrary org_ids, polluting cross-org reports.
--
-- Drop the old policy (created inside a DO block in migration_security_events.sql)
-- and replace with a stricter version.

DROP POLICY IF EXISTS security_events_insert_own ON public.security_events;

CREATE POLICY security_events_insert_own
  ON public.security_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      -- org_id is optional; when supplied it must be an org the user belongs to.
      org_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id = security_events.org_id
          AND om.user_id         = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.id       = security_events.org_id
          AND o.owner_id = auth.uid()
      )
    )
  );


-- ─── SQL-02: Scope calendar_entries SELECT ────────────────────────────────────
--
-- The existing policy `calendar_entries_select_authenticated` uses USING(true),
-- intentionally allowing cross-org availability checks. However, this exposes
-- all models' calendars to every authenticated user (including competitors).
--
-- Tighten to: model's own entry | agency members for that model |
-- clients with a non-rejected option request for that model | calendar owner.
-- Clients browsing (no option yet) still need availability — handled by the
-- option_requests check covering 'in_negotiation' entries.

DROP POLICY IF EXISTS "calendar_entries_select_authenticated" ON public.calendar_entries;

CREATE POLICY "calendar_entries_select_scoped"
  ON public.calendar_entries FOR SELECT
  TO authenticated
  USING (
    -- The model themselves
    EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id      = calendar_entries.model_id
        AND m.user_id = auth.uid()
    )
    -- Agency member via bookers (legacy)
    OR EXISTS (
      SELECT 1 FROM public.models m
      JOIN public.bookers bk ON bk.agency_id = m.agency_id
      WHERE m.id       = calendar_entries.model_id
        AND bk.user_id = auth.uid()
    )
    -- Agency member via organisations + org_members
    OR EXISTS (
      SELECT 1 FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.id       = calendar_entries.model_id
        AND om.user_id = auth.uid()
    )
    -- Agency org owner
    OR EXISTS (
      SELECT 1 FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      WHERE m.id       = calendar_entries.model_id
        AND o.owner_id = auth.uid()
    )
    -- Client with an active or completed option request for this model
    OR EXISTS (
      SELECT 1 FROM public.option_requests orq
      WHERE orq.model_id  = calendar_entries.model_id
        AND orq.client_id = auth.uid()
        AND orq.status   != 'rejected'
    )
    -- Client org member whose org has an active option request
    OR EXISTS (
      SELECT 1 FROM public.option_requests orq
      JOIN public.organization_members om ON om.user_id = auth.uid()
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE orq.model_id        = calendar_entries.model_id
        AND orq.organization_id = o.id
        AND orq.status         != 'rejected'
    )
  );


-- ─── Verification ─────────────────────────────────────────────────────────────

SELECT
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('bookings', 'calendar_entries', 'security_events')
ORDER BY tablename, policyname;
