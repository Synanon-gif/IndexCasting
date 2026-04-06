-- =============================================================================
-- Fix G: pending_territories — Ensure JSONB, Not Text (Documentation + Guard)
--
-- FINDING:
--   The DB column model_applications.pending_territories is already JSONB
--   (migration_applications_pending_territories_2026_04.sql).
--
--   The TypeScript bug: applicationsStore.ts uses JSON.stringify(territoryCodes)
--   before passing to Supabase, which sends a JSON string (TEXT) rather than a
--   native JS array. Supabase auto-casts TEXT → JSONB, so it works, but:
--     a) It is unnecessarily fragile (double-encoding risk)
--     b) If a non-JSON string is passed, the cast silently fails or raises
--     c) The intent is not clear to future developers
--
--   The TypeScript fix is in applicationsStore.ts (not here in SQL).
--
-- SQL SIDE:
--   1. Add CHECK constraint on pending_territories to enforce it must be a
--      JSONB array (jsonb_typeof = 'array') when not null.
--   2. Add DB-level comment clarifying the column must receive a native array.
--
-- Idempotent: safe to run multiple times.
-- =============================================================================

-- ─── 1. Add CHECK constraint: pending_territories must be a JSONB array ───────

ALTER TABLE public.model_applications
  DROP CONSTRAINT IF EXISTS chk_pending_territories_is_array;

ALTER TABLE public.model_applications
  ADD CONSTRAINT chk_pending_territories_is_array
  CHECK (
    pending_territories IS NULL
    OR jsonb_typeof(pending_territories) = 'array'
  );

-- ─── 2. Clarify column comment ────────────────────────────────────────────────

COMMENT ON COLUMN public.model_applications.pending_territories IS
  'Territory codes (ISO-3166-1 alpha-2 strings) chosen by the agency at accept-time. '
  'Stored as a native JSONB array, e.g. ["DE", "AT", "CH"]. '
  'DO NOT wrap with JSON.stringify() in TypeScript — pass the JS array directly. '
  'Transferred to model_agency_territories when the model confirms (trigger tr_transfer_pending_territories).';

-- ─── Verification ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name  = 'model_applications'
      AND column_name = 'pending_territories'
      AND data_type   = 'jsonb'
  ), 'FAIL: pending_territories is not JSONB';

  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_pending_territories_is_array'
  ), 'FAIL: chk_pending_territories_is_array constraint not found';

  RAISE NOTICE 'PASS: 20260413_fix_g — pending_territories is JSONB with array CHECK constraint';
END $$;
