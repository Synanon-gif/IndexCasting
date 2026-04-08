-- =============================================================================
-- One-off operational cleanup (2026-04-08): remove model + auth account so the
-- address can be used for a fresh model signup. Executed by the migration
-- runner (trusted postgres context), not exposed via PostgREST.
--
-- Order: delete legacy bookings (BEFORE DELETE guard on models), delete model
-- row (CASCADE cleans dependent public rows), then delete auth user (cascade
-- profile and frees email for re-registration).
-- =============================================================================

DO $$
DECLARE
  v_norm   text := lower(trim('rubenege82@gmail.com'));
  r        record;
  v_deleted_models integer := 0;
  v_deleted_auth   integer := 0;
BEGIN
  FOR r IN
    SELECT id AS model_id
    FROM   public.models
    WHERE  email = v_norm
  LOOP
    DELETE FROM public.bookings WHERE model_id = r.model_id;
    DELETE FROM public.models WHERE id = r.model_id;
    v_deleted_models := v_deleted_models + 1;
  END LOOP;

  DELETE FROM auth.users
  WHERE lower(trim(email)) = v_norm;

  GET DIAGNOSTICS v_deleted_auth = ROW_COUNT;

  RAISE NOTICE 'oneoff_wipe_rubenege82: models_deleted=%, auth_users_deleted=%',
    v_deleted_models, v_deleted_auth;
END $$;
