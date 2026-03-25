-- ──────────────────────────────────────────────────────────────────────────────
-- migration_models_add_sex.sql
-- Adds a `sex` column ('male' | 'female') to the models table.
-- Used for filtering and display across all app workflows.
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Add the column with a check constraint (nullable = not yet set by agency)
ALTER TABLE public.models
  ADD COLUMN IF NOT EXISTS sex text
  CHECK (sex IN ('male', 'female'));

-- 2. Update the client_filter_presets column (profiles table) to allow sex in the JSONB preset.
--    No schema change needed — the preset is stored as JSONB so any new key is accepted
--    by the existing save_client_filter_preset / load_client_filter_preset RPCs.

-- 3. Comment for reference
COMMENT ON COLUMN public.models.sex IS
  'Biological sex of the model: ''male'' or ''female''. NULL = not yet specified by agency.';
