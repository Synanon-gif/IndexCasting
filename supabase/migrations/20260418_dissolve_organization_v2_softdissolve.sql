-- =============================================================================
-- Migration A: dissolve_organization v2 — Soft-Dissolve + Member Notifications
--
-- Architecture: Two-Stage Model for organization dissolution (GDPR-compliant)
--   Stage 1 (this migration): Soft-Dissolve
--     • Mark organization as dissolved (dissolved_at, dissolved_by, scheduled_purge_at)
--     • Remove memberships + invitations IMMEDIATELY (so the owner can delete their own
--       auth account afterwards without FK constraint violations)
--     • Notify all former members via in-app notification
--     • Mark organization_subscriptions as canceled (locally; Stripe API call happens
--       in a separate Edge Function wrapper)
--     • RLS: dissolved organizations are hidden from non-admin reads
--
--   Stage 2 (next migration B): Hard-Purge after 30 days
--     • Delete all B2B data referencing this org
--     • DELETE the organizations row → cascades remaining org-scoped tables
--
-- Why soft-dissolve before hard-purge?
--   GDPR Art. 17 (right to erasure) allows a reasonable retention window for
--   billing/audit/dispute purposes. 30 days is a common industry standard.
--   During the window:
--     - Former members can log in, download personal data (Art. 15), delete account
--     - Owner can revoke (admin path) if accidental
--     - Audit logs retain org reference (set null) for compliance
--
-- Backward compatibility: dissolve_organization signature unchanged
-- (p_organization_id UUID) → returns enriched JSON for the caller.
-- =============================================================================

-- ─── 1. Schema additions on organizations ─────────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS dissolved_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dissolved_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scheduled_purge_at  TIMESTAMPTZ;

COMMENT ON COLUMN public.organizations.dissolved_at IS
  'When the organization was soft-dissolved by its owner. NULL = active.';
COMMENT ON COLUMN public.organizations.dissolved_by IS
  'auth.uid() of the owner who triggered dissolve. SET NULL on user deletion.';
COMMENT ON COLUMN public.organizations.scheduled_purge_at IS
  'When the hard-purge of all org-referencing data is scheduled (typically dissolved_at + 30 days). '
  'Cron job purge_dissolved_organizations_daily processes orgs whose scheduled_purge_at <= now().';

CREATE INDEX IF NOT EXISTS organizations_dissolved_at_idx
  ON public.organizations (dissolved_at)
  WHERE dissolved_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS organizations_scheduled_purge_at_idx
  ON public.organizations (scheduled_purge_at)
  WHERE scheduled_purge_at IS NOT NULL;

-- ─── 2. dissolve_organization v2 ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dissolve_organization(p_organization_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller_uid          uuid := auth.uid();
  v_owner_id            uuid;
  v_org_name            text;
  v_org_type            text;
  v_member_count        int;
  v_purge_at            timestamptz;
  v_stripe_customer     text;
  v_stripe_subscription text;
  v_member             record;
BEGIN
  IF v_caller_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- Owner-only guard.
  SELECT owner_id, name, type::text
    INTO v_owner_id, v_org_name, v_org_type
    FROM public.organizations
   WHERE id = p_organization_id
     AND dissolved_at IS NULL
   FOR UPDATE;

  IF v_owner_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'organization_not_found_or_already_dissolved');
  END IF;

  IF v_owner_id IS DISTINCT FROM v_caller_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden_not_owner');
  END IF;

  v_purge_at := now() + INTERVAL '30 days';

  -- Capture Stripe references for the Edge wrapper to cancel the subscription.
  SELECT stripe_customer_id, stripe_subscription_id
    INTO v_stripe_customer, v_stripe_subscription
    FROM public.organization_subscriptions
   WHERE organization_id = p_organization_id;

  -- Notify every former member (excluding the owner) BEFORE deleting memberships.
  -- We bypass the notifications INSERT policy via SECURITY DEFINER + row_security off.
  v_member_count := 0;
  FOR v_member IN
    SELECT om.user_id
      FROM public.organization_members om
     WHERE om.organization_id = p_organization_id
       AND om.user_id IS DISTINCT FROM v_caller_uid
  LOOP
    BEGIN
      INSERT INTO public.notifications (
        user_id,
        organization_id,
        type,
        title,
        message,
        metadata
      ) VALUES (
        v_member.user_id,
        NULL,                                  -- personal notification, not org-scoped
        'organization_dissolved',
        'Your organization has been closed',
        format(
          'The organization "%s" was permanently dissolved by its owner. ' ||
          'You can still log in to delete your account or download your personal data. ' ||
          'All shared organization data will be permanently deleted on %s.',
          v_org_name,
          to_char(v_purge_at, 'YYYY-MM-DD')
        ),
        jsonb_build_object(
          'kind',                'organization_dissolved',
          'organization_id',     p_organization_id,
          'organization_name',   v_org_name,
          'organization_type',   v_org_type,
          'dissolved_at',        now(),
          'scheduled_purge_at',  v_purge_at,
          'dissolved_by',        v_caller_uid
        )
      );
      v_member_count := v_member_count + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Never let a single notification failure block the dissolve.
      RAISE WARNING 'dissolve_organization: failed to notify member % for org %: %',
        v_member.user_id, p_organization_id, SQLERRM;
    END;
  END LOOP;

  -- Remove memberships + invitations now so the owner can delete their auth account.
  DELETE FROM public.organization_members WHERE organization_id = p_organization_id;
  DELETE FROM public.invitations          WHERE organization_id = p_organization_id;

  -- Soft-dissolve the org. RLS now hides it from non-admin reads.
  UPDATE public.organizations
     SET dissolved_at       = now(),
         dissolved_by       = v_caller_uid,
         scheduled_purge_at = v_purge_at,
         is_active          = false
   WHERE id = p_organization_id;

  -- Mark subscription as canceled locally; Edge wrapper handles the actual Stripe call.
  UPDATE public.organization_subscriptions
     SET status = 'canceled'
   WHERE organization_id = p_organization_id;

  RETURN jsonb_build_object(
    'ok',                       true,
    'organization_id',          p_organization_id,
    'organization_name',        v_org_name,
    'dissolved_at',             now(),
    'scheduled_purge_at',       v_purge_at,
    'notified_members',         v_member_count,
    'stripe_customer_id',       v_stripe_customer,
    'stripe_subscription_id',   v_stripe_subscription
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dissolve_organization(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dissolve_organization(UUID) TO authenticated;

COMMENT ON FUNCTION public.dissolve_organization(uuid) IS
  'v2 (2026-04-18): Soft-dissolves an organization. '
  'Marks dissolved_at + scheduled_purge_at (now() + 30 days), removes memberships & invitations, '
  'sends in-app notifications to former members, marks subscription as canceled. '
  'Returns Stripe references so the caller (Edge wrapper) can cancel the live subscription. '
  'Hard-purge of all referencing data happens via run_scheduled_purge_dissolved_organizations() '
  'after the 30-day window.';

-- ─── 3. RLS: hide dissolved organizations from non-admin SELECTs ──────────────
-- We add a NEW policy that explicitly excludes dissolved orgs for non-admin reads.
-- Existing policies remain in place for backward compatibility; this one acts as
-- an additional restrictive filter for member-based reads.
DROP POLICY IF EXISTS "organizations_hide_dissolved_from_non_admin"
  ON public.organizations;

-- Note: PostgreSQL combines multiple PERMISSIVE policies with OR. To enforce that
-- dissolved orgs are hidden, we make an additional RESTRICTIVE policy on SELECT.
DROP POLICY IF EXISTS "organizations_select_hide_dissolved_restrictive"
  ON public.organizations;

CREATE POLICY "organizations_select_hide_dissolved_restrictive"
  ON public.organizations
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    dissolved_at IS NULL
    OR public.is_current_user_admin()
  );

COMMENT ON POLICY "organizations_select_hide_dissolved_restrictive"
  ON public.organizations IS
  'Restrictive policy: hides dissolved organizations from all non-admin SELECTs. '
  'Combines (AND) with permissive member/owner SELECT policies.';

-- ─── 4. Verification ──────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'dissolve_organization';

  ASSERT v_def ILIKE '%dissolved_at%',         'FAIL: v2 must reference dissolved_at';
  ASSERT v_def ILIKE '%scheduled_purge_at%',   'FAIL: v2 must reference scheduled_purge_at';
  ASSERT v_def ILIKE '%notifications%',        'FAIL: v2 must INSERT into notifications';
  ASSERT v_def ILIKE '%organization_dissolved%', 'FAIL: v2 must use organization_dissolved type';
  ASSERT v_def ILIKE '%row_security TO %off%',  'FAIL: v2 must SET row_security TO off';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='organizations' AND column_name='dissolved_at'
  ), 'FAIL: organizations.dissolved_at missing';

  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='organizations'
       AND policyname='organizations_select_hide_dissolved_restrictive'
  ), 'FAIL: restrictive RLS policy missing';
END $$;
