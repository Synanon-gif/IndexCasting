-- =============================================================================
-- One-off operational cleanup (2026-04-09): remove agency roster model row for
-- ruben.elge@student.uibk.ac.at (user typo: studen.uibk.ac.at).
--
-- Live check: models row exists with user_id NULL, no auth.users, 0 model_photos.
-- Order matches prior oneoff (20260408_z_oneoff_wipe_model_rubenege82.sql).
-- =============================================================================

DO $$
DECLARE
  v_model_id constant uuid := '6b9100ae-c77b-4aae-917c-2826929bd01c';
  v_email    constant text := lower(trim('ruben.elge@student.uibk.ac.at'));
  v_deleted  integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.models
    WHERE id = v_model_id
      AND lower(trim(email)) = v_email
  ) THEN
    RAISE NOTICE 'oneoff_delete_ruben_elge_student_uibk: skip — model already absent or email mismatch';
    RETURN;
  END IF;

  DELETE FROM public.bookings WHERE model_id = v_model_id;

  DELETE FROM public.models WHERE id = v_model_id AND lower(trim(email)) = v_email;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE NOTICE 'oneoff_delete_ruben_elge_student_uibk: models_deleted=%', v_deleted;
END $$;
