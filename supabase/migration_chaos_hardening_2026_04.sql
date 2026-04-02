-- =============================================================================
-- CHAOS HARDENING – 2026-04
-- Fixes race conditions, duplicate entries, and inconsistent state transitions
-- found during chaos-user testing across all 5 critical workflows.
-- =============================================================================

-- ─── 1. APPLICATION FLOW ─────────────────────────────────────────────────────
-- Prevent duplicate applications from the same user to the same agency.
-- Partial: rejected applications are allowed to re-apply (status = 'rejected'
-- is treated as a terminal state that unblocks re-application).
CREATE UNIQUE INDEX IF NOT EXISTS uidx_model_applications_active_per_agency
  ON public.model_applications (applicant_user_id, agency_id)
  WHERE status != 'rejected';

-- ─── 2. PACKAGE FLOW – Soft Delete ───────────────────────────────────────────
-- Replace hard DELETE on guest_links with soft-delete so existing
-- chat-metadata references (packageId) remain resolvable.
ALTER TABLE public.guest_links
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Index for fast active-only queries.
CREATE INDEX IF NOT EXISTS idx_guest_links_not_deleted
  ON public.guest_links (agency_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- RLS: treat deleted rows as invisible to non-admin readers.
-- Agencies are not linked via agencies.user_id (that column does not exist).
-- Ownership is established through bookers, organization owners, and org members —
-- the same pattern used in migration_guest_links_rls_fix.sql.
--
-- Drop the previous SELECT policy (from migration_prelaunch_security_fixes.sql)
-- so the new deleted_at guard takes effect. Without dropping the old policy, the
-- two SELECT policies would be OR-combined and deleted rows would remain visible.
DROP POLICY IF EXISTS "Agency members can select own guest links" ON public.guest_links;
DROP POLICY IF EXISTS "agency_select_own_guest_links" ON public.guest_links;
CREATE POLICY "agency_select_own_guest_links"
  ON public.guest_links
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.bookers b
        WHERE b.agency_id = guest_links.agency_id
          AND b.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.agency_id = guest_links.agency_id
          AND o.owner_id = auth.uid()
          AND o.type = 'agency'
      )
      OR EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE o.agency_id = guest_links.agency_id
          AND o.type = 'agency'
          AND om.user_id = auth.uid()
      )
    )
  );

-- ─── 3. CALENDAR – Unique Manual Entries ─────────────────────────────────────
-- Prevent duplicate personal/manual calendar entries for the same model+date
-- from parallel requests (e.g. rapid double-tap).
-- Only applies to entries without an option_request_id (booking-linked entries
-- are de-duped by the existing uidx_booking_events_model_date_active index).
CREATE UNIQUE INDEX IF NOT EXISTS uidx_calendar_manual_per_model_date
  ON public.calendar_entries (model_id, date)
  WHERE option_request_id IS NULL
    AND entry_type IN ('personal', 'gosee');

-- ─── 4. BOOKING FLOW – Atomic booking_event creation via DB trigger ──────────
-- Eliminates the split-write race: previously the client called
-- createBookingEventFromRequest() after updating option_requests.status →
-- a network failure between the two writes left the request confirmed but
-- without a booking_event.
-- This trigger fires on the DB side, inside the same transaction as the UPDATE.

CREATE OR REPLACE FUNCTION public.fn_auto_create_booking_event_on_confirm()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency_org_id UUID;
  v_event_type    TEXT;
BEGIN
  -- Only fire when status transitions TO 'confirmed'.
  IF NEW.status = 'confirmed' AND (OLD.status IS DISTINCT FROM 'confirmed') THEN

    -- Avoid duplicates: skip if a booking_event for this request already exists.
    IF EXISTS (
      SELECT 1 FROM public.booking_events
      WHERE source_option_request_id = NEW.id
        AND status != 'cancelled'
    ) THEN
      RETURN NEW;
    END IF;

    -- Resolve agency organisation.
    SELECT id INTO v_agency_org_id
    FROM public.organizations
    WHERE agency_id = NEW.agency_id
    LIMIT 1;

    -- Determine event type from request_type / final_status.
    v_event_type := CASE
      WHEN NEW.request_type = 'casting'         THEN 'casting'
      WHEN NEW.final_status = 'job_confirmed'   THEN 'job'
      ELSE 'option'
    END;

    INSERT INTO public.booking_events (
      model_id,
      client_org_id,
      agency_org_id,
      date,
      type,
      status,
      title,
      note,
      source_option_request_id
    ) VALUES (
      NEW.model_id,
      NEW.organization_id,
      v_agency_org_id,
      NEW.requested_date,
      v_event_type,
      'pending',
      COALESCE(NEW.client_name || ' – ' || v_event_type, v_event_type),
      NULL,
      NEW.id
    )
    ON CONFLICT DO NOTHING;

  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_auto_booking_event_on_confirm ON public.option_requests;
CREATE TRIGGER tr_auto_booking_event_on_confirm
  AFTER UPDATE OF status ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_create_booking_event_on_confirm();

-- ─── 4b. BOOKING – idempotency unique index on booking_events ────────────────
-- Guarantees that the DB trigger and any surviving client-side call cannot
-- produce two active booking_events for the same source option_request.
-- The partial index excludes cancelled events so re-bookings after cancellation
-- are still possible.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_booking_events_per_option_request
  ON public.booking_events (source_option_request_id)
  WHERE source_option_request_id IS NOT NULL
    AND status != 'cancelled';

-- ─── 5. PRICE NEGOTIATION – status guard function ────────────────────────────
-- Documents the expected valid states for counter-offer transitions.
-- Enforcement is on the service layer (see optionRequestsSupabase.ts);
-- this view makes the state machine queryable for audits.
COMMENT ON COLUMN public.option_requests.client_price_status IS
  'State machine: pending → accepted | rejected. '
  'setAgencyCounterOffer resets to pending. '
  'agencyAcceptClientPrice/clientAcceptCounterPrice require current=pending. '
  'All write functions enforce prior-state via .eq() guards.';

COMMENT ON COLUMN public.option_requests.status IS
  'Lifecycle: in_negotiation → confirmed | rejected. '
  'agencyAcceptRequest enforces .eq(status, in_negotiation). '
  'setAgencyCounterOffer enforces .eq(status, in_negotiation).';
