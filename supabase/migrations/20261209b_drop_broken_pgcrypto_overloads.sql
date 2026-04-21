-- =============================================================================
-- 20261209b: Remove the unused, pgcrypto-broken zero-arg overload of
--            enforce_guest_link_rate_limit().
--
-- WHY: prod has TWO overloads:
--   - enforce_guest_link_rate_limit()           (uses digest() → pgcrypto → 42883)
--   - enforce_guest_link_rate_limit(integer)    (uses sha256() → built-in OK)
--
-- Live caller analysis (get_guest_link_info, get_guest_link_models) confirmed
-- that ONLY the (integer) overload is ever called from server code:
--   get_guest_link_info(...)   → enforce_guest_link_rate_limit(60)
--   get_guest_link_models(...) → enforce_guest_link_rate_limit(30)
--
-- The 0-arg overload is dead but represents a latent landmine (PostgREST RPC
-- discovery exposes every overload; a careless client could trip it). Drop it
-- so the only callable signature is the safe one.
-- =============================================================================

DROP FUNCTION IF EXISTS public.enforce_guest_link_rate_limit();

DO $$
BEGIN
  ASSERT NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'enforce_guest_link_rate_limit'
      AND p.pronargs = 0
  ), 'FAIL: enforce_guest_link_rate_limit() (0-arg pgcrypto overload) still present after 20261209b';

  ASSERT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'enforce_guest_link_rate_limit'
      AND p.pronargs = 1
  ), 'FAIL: enforce_guest_link_rate_limit(integer) overload missing — must keep the safe one';
END;
$$;

-- =============================================================================
-- GLOBAL guard: assert NO public.* function references gen_random_bytes() or
-- pgp_sym_*() or unqualified digest(). pgcrypto lives in `extensions` schema
-- here and is NOT on the default search_path of any of our SECURITY DEFINER
-- functions → using it triggers 42883. This guard catches every regression
-- the second a future migration applies.
-- =============================================================================
DO $$
DECLARE
  v_offender record;
  v_msgs text := '';
BEGIN
  FOR v_offender IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND (
        p.prosrc ~* '\mgen_random_bytes\s*\('
        OR p.prosrc ~* '\mpgp_sym_(en|de)crypt\s*\('
        -- digest() is allowed only as `extensions.digest(`; bare `digest(` is not
        OR (p.prosrc ~* '\mdigest\s*\(' AND p.prosrc !~* 'extensions\.digest\s*\(')
      )
  LOOP
    v_msgs := v_msgs || format(E'\n  - %I(%s)', v_offender.proname, v_offender.args);
  END LOOP;

  IF length(v_msgs) > 0 THEN
    RAISE EXCEPTION
      E'FAIL: pgcrypto regression — the following public functions still reference gen_random_bytes() / pgp_sym_*() / bare digest(). pgcrypto is not on search_path on this project; use sha256()/gen_random_uuid() instead.\nOffenders:%s',
      v_msgs;
  END IF;
END;
$$;
