-- Sports Categories: Winter Sports / Summer Sports
-- Adds two independent boolean flags to models (separate dimension from Fashion/Commercial categories).
-- Default false → no existing model is accidentally assigned to sports.
-- RLS: no changes needed — existing SELECT/UPDATE policies on models cover all columns.

ALTER TABLE public.models
  ADD COLUMN IF NOT EXISTS is_sports_winter BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_sports_summer BOOLEAN NOT NULL DEFAULT false;

-- Partial indexes for fast sports-filtered client discovery.
CREATE INDEX IF NOT EXISTS idx_models_sports_winter
  ON public.models (is_sports_winter)
  WHERE is_sports_winter = true;

CREATE INDEX IF NOT EXISTS idx_models_sports_summer
  ON public.models (is_sports_summer)
  WHERE is_sports_summer = true;

COMMENT ON COLUMN public.models.is_sports_winter IS
  'Model is bookable for Winter Sports campaigns. Independent of Fashion/Commercial/categories.';

COMMENT ON COLUMN public.models.is_sports_summer IS
  'Model is bookable for Summer Sports campaigns. Independent of Fashion/Commercial/categories.';
