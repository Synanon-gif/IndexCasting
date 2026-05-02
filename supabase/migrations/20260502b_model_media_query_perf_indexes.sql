-- =============================================================================
-- Hot-path indexes for model_photos / models — reduces statement timeouts (57014)
-- on filtered ORDER BY and model-self RLS subqueries.
-- Additive only: CREATE INDEX IF NOT EXISTS — no RLS or policy changes.
-- =============================================================================

-- Exact match for app pattern: model_id + photo_type + sort_order
CREATE INDEX IF NOT EXISTS idx_model_photos_model_id_photo_type_sort_order
  ON public.model_photos (model_id, photo_type, sort_order ASC NULLS LAST);

-- Speeds EXISTS (... models m WHERE m.user_id = auth.uid() ...) in RLS and lookups
CREATE INDEX IF NOT EXISTS idx_models_user_id
  ON public.models (user_id)
  WHERE user_id IS NOT NULL;

COMMENT ON INDEX public.idx_model_photos_model_id_photo_type_sort_order IS
  'Covers getPhotosForModel / PostgREST: eq model_id + photo_type, order sort_order.';

COMMENT ON INDEX public.idx_models_user_id IS
  'Partial index: linked models by auth user — RLS and profile joins.';
