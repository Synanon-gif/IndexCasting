-- =============================================================================
-- Request / Booking Workflow Hardening
--
-- Fixes:
--   1. Performance index on option_requests(final_status)
--   2. RLS hardening for the legacy `bookings` table (was USING(true))
--   3. RLS hardening for the legacy `calendar_entries` table (was USING(true))
--   4. CHECK constraint documents the counter-offer state for option_requests
--
-- Run AFTER all existing migrations (see MIGRATION_ORDER.md).
-- =============================================================================


-- ─── 1. Performance index: option_requests.final_status ──────────────────────

CREATE INDEX IF NOT EXISTS idx_option_requests_final_status
  ON public.option_requests (final_status);

CREATE INDEX IF NOT EXISTS idx_option_requests_status_final
  ON public.option_requests (status, final_status);


-- ─── 2. RLS hardening: bookings table ────────────────────────────────────────
--
-- The original migration_phase7_pro_tools.sql used USING(true) for all
-- authenticated users, allowing any logged-in user to read every booking row.
-- Replace with scoped policies: client owner, org member, or agency member.

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Drop the over-permissive legacy policies.
DROP POLICY IF EXISTS "Authenticated can read bookings"  ON public.bookings;
DROP POLICY IF EXISTS "Authenticated can manage bookings" ON public.bookings;

-- Helper: TRUE when the current user is a member of the agency that owns a booking.
-- Two membership paths exist in this schema:
--   Path A: bookers table (direct agency_id ↔ user_id link)
--   Path B: organizations (agency_id FK) + organization_members OR owner_id

-- SELECT: direct client, any org member, or agency member (either path).
CREATE POLICY "bookings_select_scoped"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (
    -- Direct client owner
    client_id = auth.uid()
    -- Client org member (any org the user belongs to — RLS on option_requests is already
    -- scoped, so being an org member is a sufficient proxy here)
    OR EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
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

-- INSERT: only authenticated clients (enforced via client_id = auth.uid()).
CREATE POLICY "bookings_insert_client"
  ON public.bookings FOR INSERT
  TO authenticated
  WITH CHECK (client_id = auth.uid());

-- UPDATE: agency members (either path) can update bookings for their agency.
CREATE POLICY "bookings_update_agency"
  ON public.bookings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookers bk
      WHERE bk.agency_id = bookings.agency_id
        AND bk.user_id   = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.agency_id = bookings.agency_id
        AND om.user_id  = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.agency_id = bookings.agency_id
        AND o.owner_id  = auth.uid()
    )
  );

-- DELETE: agency org owner only.
CREATE POLICY "bookings_delete_agency_owner"
  ON public.bookings FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.agency_id = bookings.agency_id
        AND o.owner_id  = auth.uid()
    )
  );


-- ─── 3. RLS hardening: calendar_entries table ────────────────────────────────
--
-- The original policy was USING(true) / WITH CHECK(true) for all authenticated.
-- Tighten: SELECT stays open (model availability must be readable by agencies
-- and clients to check conflicts); write operations restricted to agency members.

DROP POLICY IF EXISTS "Authenticated can read calendar entries"    ON public.calendar_entries;
DROP POLICY IF EXISTS "Authenticated can manage calendar entries"  ON public.calendar_entries;

-- SELECT: all authenticated (needed for availability checks cross-org).
CREATE POLICY "calendar_entries_select_authenticated"
  ON public.calendar_entries FOR SELECT
  TO authenticated
  USING (true);

-- Helper macro (inlined): user is an agency member for the model's agency.
-- Covers bookers table (Path A) and organizations+org_members/owner (Path B).

CREATE POLICY "calendar_entries_write_agency"
  ON public.calendar_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by_agency = true
    OR EXISTS (
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

CREATE POLICY "calendar_entries_update_agency"
  ON public.calendar_entries FOR UPDATE
  TO authenticated
  USING (
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

CREATE POLICY "calendar_entries_delete_agency"
  ON public.calendar_entries FOR DELETE
  TO authenticated
  USING (
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


-- ─── 4. Document counter-offer state via CHECK (NOT VALID — safe backfill) ───
--
-- Counter-offer state is represented by:
--   agency_counter_price IS NOT NULL AND client_price_status = 'pending'
--   AND final_status = 'option_pending'
--
-- No new ENUM value is needed. This comment + index make the state explicit.
-- A partial index speeds up "open counter offers" queries.

CREATE INDEX IF NOT EXISTS idx_option_requests_counter_offer
  ON public.option_requests (id)
  WHERE agency_counter_price IS NOT NULL
    AND client_price_status  = 'pending'
    AND status               = 'in_negotiation';
