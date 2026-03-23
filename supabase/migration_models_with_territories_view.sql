-- =============================================================================
-- Performance + correctness: optimized discovery query via a stable view
-- View returns one row per (model_id, country_code) with agency name for that territory.
-- =============================================================================

CREATE OR REPLACE VIEW public.models_with_territories AS
SELECT
  m.*,
  mat.country_code AS territory_country_code,
  mat.agency_id AS territory_agency_id,
  a.name AS agency_name
FROM public.model_agency_territories mat
JOIN public.models m
  ON m.id = mat.model_id
JOIN public.agencies a
  ON a.id = mat.agency_id;

