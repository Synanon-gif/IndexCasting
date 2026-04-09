-- =============================================================================
-- One-off operational cleanup (2026-04-10): remove agency roster model row for
-- ruben.elge@student.uibk.ac.at (re-created after prior 20260409 one-off delete).
--
-- Live: models.id = ebf6a6f9-1c9b-44a7-a9c4-3d821daa712f, user_id NULL, 0 photos.
-- =============================================================================

DO $$
DECLARE
  v_model_id constant uuid := 'ebf6a6f9-1c9b-44a7-a9c4-3d821daa712f';
  v_email    constant text := lower(trim('ruben.elge@student.uibk.ac.at'));
  v_deleted  integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.models
    WHERE id = v_model_id
      AND lower(trim(email)) = v_email
  ) THEN
    RAISE NOTICE 'oneoff_delete_ruben_elge_student_uibk_retry: skip — model already absent or email mismatch';
    RETURN;
  END IF;

  DELETE FROM public.bookings WHERE model_id = v_model_id;

  DELETE FROM public.models WHERE id = v_model_id AND lower(trim(email)) = v_email;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE NOTICE 'oneoff_delete_ruben_elge_student_uibk_retry: models_deleted=%', v_deleted;
END $$;
