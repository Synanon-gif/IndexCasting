-- =============================================================================
-- Model categories: granular marketing-segment tagging for models.
--
-- Values are the same 3 options used for agencies (agencies.agency_types):
--   'Fashion' | 'High Fashion' | 'Commercial'
--
-- Semantics (aligned with agency_types convention):
--   NULL or '{}'  → model is visible in ALL category filters (default / uncategorised)
--   '{Fashion}'   → model only appears when filtering by "Fashion"
--   '{Fashion','High Fashion'} → appears in both those filters
-- =============================================================================

ALTER TABLE public.models
  ADD COLUMN IF NOT EXISTS categories TEXT[] DEFAULT NULL;

COMMENT ON COLUMN public.models.categories IS
  'Marketing categories: Fashion, High Fashion, Commercial. '
  'NULL or empty array = visible in all category filters (default for uncategorised models).';

-- Fast lookup for category-based client discovery
CREATE INDEX IF NOT EXISTS idx_models_categories
  ON public.models USING gin (categories);
