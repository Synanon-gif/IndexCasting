-- 20260920_calendar_entries_updated_at_column.sql
--
-- Restore + harden: add canonical `updated_at` column to public.calendar_entries.
--
-- Background
-- ----------
-- Service code (src/services/calendarSupabase.ts) — `appendSharedBookingNote`
-- and `updateBookingDetails` — was designed with an optimistic concurrency
-- lock on `calendar_entries.updated_at`. The column was never created on the
-- live DB (only `created_at` existed), so every `select(... updated_at ...)`
-- returned PostgreSQL 42703 ("column calendar_entries.updated_at does not
-- exist"), which broke shared notes save, booking-brief save and any
-- detail-view path that read those fields.
--
-- This migration restores the intended schema by:
--   1) adding `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
--   2) backfilling rows from `created_at` to keep ordering stable,
--   3) attaching the canonical `public.set_updated_at()` BEFORE UPDATE trigger
--      so the column auto-advances on every UPDATE, which is what the
--      optimistic-lock CAS in the service relies on.
--
-- Notes
-- -----
-- * Idempotent (`ADD COLUMN IF NOT EXISTS`, `DROP TRIGGER IF EXISTS`).
-- * No RLS changes. The canonical RLS policy set defined in
--   `20260502_calendar_entries_rls_canonical_client_update.sql` is preserved.
-- * `booking_brief` / `booking_details` remain UI-filtered JSONB (trust model
--   per docs/BOOKING_BRIEF_SYSTEM.md). This migration only adds an audit-friendly
--   timestamp + concurrency token; no field-level RLS is introduced.

-- 1) Add the column with safe default + backfill from created_at.
ALTER TABLE public.calendar_entries
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.calendar_entries
SET updated_at = created_at
WHERE updated_at < created_at OR updated_at = '1970-01-01'::timestamptz;

-- 2) Attach BEFORE UPDATE trigger using the canonical helper.
DROP TRIGGER IF EXISTS calendar_entries_set_updated_at ON public.calendar_entries;
CREATE TRIGGER calendar_entries_set_updated_at
  BEFORE UPDATE ON public.calendar_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON COLUMN public.calendar_entries.updated_at IS
  'Last-modified timestamp; auto-maintained by trigger calendar_entries_set_updated_at. '
  'Used as an optimistic-lock token by appendSharedBookingNote / updateBookingDetails '
  '(src/services/calendarSupabase.ts).';
