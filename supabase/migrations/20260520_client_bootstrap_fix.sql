-- =============================================================================
-- CLIENT BOOTSTRAP INCIDENT FIX (2026-05-20)
--
-- Root cause: record_trial_email_hashes() uses digest() from pgcrypto but its
-- search_path is 'public' only (migration 20260406 dropped 'extensions').
-- pgcrypto lives in the 'extensions' schema on Supabase → 42883 at runtime.
--
-- Cascade: ensure_client_organization → INSERT organizations →
--   trigger_auto_create_org_subscription → INSERT organization_subscriptions →
--   trg_record_trial_email_hashes → digest() fails → full rollback → HTTP 400.
--
-- Fixes:
--   A) record_trial_email_hashes: replace digest() with sha256() (PG13+ built-in)
--   B) auto_create_org_subscription: re-create via migration (was root-SQL only)
--   C) ensure_plain_signup_b2b_owner_bootstrap: add exception handler
--   D) Backfill orgs without subscription rows
--
-- Idempotent: CREATE OR REPLACE, ON CONFLICT DO NOTHING.
-- =============================================================================


-- ─── FIX A: record_trial_email_hashes — sha256() instead of digest() ────────
--
-- digest() requires pgcrypto extension in search_path.
-- sha256(bytea) is built into PostgreSQL 13+ — no extension needed.

CREATE OR REPLACE FUNCTION public.record_trial_email_hashes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $function$
BEGIN
  IF NEW.trial_ends_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.trial_ends_at IS NOT DISTINCT FROM OLD.trial_ends_at THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.used_trial_emails (email_hash, source_org)
  SELECT
    encode(sha256(lower(au.email)::bytea), 'hex'),
    NEW.organization_id
  FROM public.organization_members om
  JOIN auth.users au ON au.id = om.user_id
  WHERE om.organization_id = NEW.organization_id
    AND au.email IS NOT NULL
  ON CONFLICT (email_hash) DO NOTHING;

  RETURN NEW;
END;
$function$;


-- ─── FIX B: auto_create_org_subscription — ensure trigger via migration ─────
--
-- Previously defined only in root-SQL (migration_paywall_billing.sql).
-- Recreate idempotently so it is tracked in the migrations folder.

CREATE OR REPLACE FUNCTION public.auto_create_org_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.organization_subscriptions (
    organization_id,
    status,
    trial_ends_at
  )
  VALUES (NEW.id, 'trialing', now() + INTERVAL '30 days')
  ON CONFLICT (organization_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_auto_create_org_subscription ON public.organizations;
CREATE TRIGGER trigger_auto_create_org_subscription
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_org_subscription();


-- ─── FIX C: ensure_plain_signup_b2b_owner_bootstrap — exception handler ─────
--
-- Without an exception handler, any RAISE from ensure_client_organization or
-- ensure_agency_organization propagates as HTTP 400 to the client. Wrap both
-- paths in BEGIN … EXCEPTION so callers get structured JSON instead.

CREATE OR REPLACE FUNCTION public.ensure_plain_signup_b2b_owner_bootstrap()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  prole  text;
  mcount int;
  aid    uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT role::text INTO prole FROM public.profiles WHERE id = auth.uid();

  IF prole IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_profile');
  END IF;

  IF prole NOT IN ('client', 'agent') THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_b2b');
  END IF;

  SELECT COUNT(*)::int INTO mcount FROM public.organization_members WHERE user_id = auth.uid();
  IF mcount > 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'has_org_membership');
  END IF;

  IF prole = 'client' THEN
    BEGIN
      PERFORM public.ensure_client_organization();
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', 'client_org_bootstrap_failed',
                                'detail', SQLERRM);
    END;
    RETURN jsonb_build_object('ok', true, 'bootstrap', 'client_owner');
  END IF;

  -- prole = 'agent'
  BEGIN
    SELECT public.ensure_agency_for_current_agent() INTO aid;
    IF aid IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'agency_row_failed');
    END IF;
    PERFORM public.ensure_agency_organization(aid);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'agency_org_bootstrap_failed',
                              'detail', SQLERRM);
  END;

  RETURN jsonb_build_object('ok', true, 'bootstrap', 'agency_owner', 'agency_id', aid);
END;
$function$;

REVOKE ALL    ON FUNCTION public.ensure_plain_signup_b2b_owner_bootstrap() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_plain_signup_b2b_owner_bootstrap() TO authenticated;

COMMENT ON FUNCTION public.ensure_plain_signup_b2b_owner_bootstrap() IS
  'Idempotent B2B owner bootstrap. Called on every login/signup for client/agent roles. '
  'Creates org + membership if missing. Returns JSON, never raises (exception handler added 20260520).';


-- ─── FIX D: Backfill orgs without subscription rows ─────────────────────────
--
-- Any organization created while the trigger was broken (or before the trigger
-- existed) may lack a subscription row. Give them a fresh 30-day trial.

INSERT INTO public.organization_subscriptions (organization_id, status, trial_ends_at)
SELECT o.id, 'trialing', now() + INTERVAL '30 days'
FROM   public.organizations o
WHERE  NOT EXISTS (
  SELECT 1 FROM public.organization_subscriptions os
  WHERE os.organization_id = o.id
)
ON CONFLICT (organization_id) DO NOTHING;


-- ─── VERIFICATION ────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- Verify record_trial_email_hashes no longer uses digest()
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.proname = 'record_trial_email_hashes'
      AND p.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND p.prokind = 'f'
      AND pg_get_functiondef(p.oid) ILIKE '%digest(%'
  ), 'FAIL: record_trial_email_hashes still references digest()';

  -- Verify trigger exists on organizations
  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_auto_create_org_subscription'
      AND tgrelid = 'public.organizations'::regclass
  ), 'FAIL: trigger_auto_create_org_subscription missing on organizations';

  -- Verify trigger exists on organization_subscriptions
  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_record_trial_email_hashes'
      AND tgrelid = 'public.organization_subscriptions'::regclass
  ), 'FAIL: trg_record_trial_email_hashes missing on organization_subscriptions';

  -- Verify bootstrap function has exception handling
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.proname = 'ensure_plain_signup_b2b_owner_bootstrap'
      AND p.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND p.prokind = 'f'
      AND pg_get_functiondef(p.oid) ILIKE '%client_org_bootstrap_failed%'
  ), 'FAIL: ensure_plain_signup_b2b_owner_bootstrap missing exception handler';

  RAISE NOTICE 'ALL VERIFICATIONS PASSED';
END $$;
