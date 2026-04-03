-- =============================================================================
-- booking_events: Add financial columns for bookings table consolidation
--
-- This migration adds optional financial fields to booking_events so it can
-- eventually serve as the single source of truth for both scheduling and billing.
-- All columns are nullable for backward compatibility with existing rows.
--
-- Once populated, the legacy `bookings` table can be deprecated and the
-- get_agency_revenue() RPC migrated to use booking_events instead.
-- =============================================================================

ALTER TABLE public.booking_events
  ADD COLUMN IF NOT EXISTS fee_total         numeric(12, 2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS commission_rate   numeric(5, 2)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS commission_amount numeric(12, 2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS currency          text           DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS project_id        uuid           DEFAULT NULL;

COMMENT ON COLUMN public.booking_events.fee_total         IS 'Total fee for the booking in the specified currency.';
COMMENT ON COLUMN public.booking_events.commission_rate   IS 'Agency commission percentage (0–100).';
COMMENT ON COLUMN public.booking_events.commission_amount IS 'Computed: fee_total * commission_rate / 100.';
COMMENT ON COLUMN public.booking_events.currency          IS 'ISO-4217 currency code. Default EUR.';
COMMENT ON COLUMN public.booking_events.project_id        IS 'Optional link to client_projects.id (legacy bookings field).';

-- Index for financial aggregation queries (agency revenue).
CREATE INDEX IF NOT EXISTS idx_booking_events_agency_financial
  ON public.booking_events (agency_org_id, status, date)
  WHERE fee_total IS NOT NULL;
