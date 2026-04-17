-- =============================================================================
-- 20260916: One-time idempotent backfill — ghost accepted applications
--
-- Problem: legacy rows may still have model_applications.status = 'accepted'
-- while no model_agency_territories row links (models.id, accepted_by_agency_id).
-- That misleads Recruiting and can block re-apply semantics.
--
-- MUST be applied once in production (idempotent — safe to re-run; client logs BACKFILL_STATUS in __DEV__):
-- - Only touches status = 'accepted' (not pending_model_confirmation: that state
--   often legitimately has no MAT until the model confirms).
-- - applicant_user_id is auth user id; MAT uses models.id — join via models.user_id.
-- =============================================================================

UPDATE public.model_applications ma
SET status = 'representation_ended'::public.application_status,
    updated_at = now()
WHERE ma.status = 'accepted'
  AND ma.accepted_by_agency_id IS NOT NULL
  AND ma.applicant_user_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.models m
    WHERE m.user_id = ma.applicant_user_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.model_agency_territories mat
    INNER JOIN public.models m ON m.id = mat.model_id AND m.user_id = ma.applicant_user_id
    WHERE mat.agency_id = ma.accepted_by_agency_id
  );
