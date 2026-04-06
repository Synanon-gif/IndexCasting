-- =============================================================================
-- Fix C: can_access_platform — Document LIMIT 1 deviation (Risiko 10)
-- Date: 2026-04-17
--
-- Context:
--   can_access_platform() uses LIMIT 1 to resolve the caller's org:
--     SELECT om.organization_id, o.type ... ORDER BY om.created_at ASC LIMIT 1
--
--   Risiko 10 (system-invariants.mdc) forbids LIMIT 1 for org context
--   resolution (get_my_org_context). However, can_access_platform is a
--   PAYWALL check, not a general auth-context resolver.
--
-- Acceptable Deviation (explicitly documented):
--   1. Scope: This is a paywall gate, not login context resolution.
--      The function answers "can this user access the platform?" not
--      "which org is this user a member of for routing purposes?".
--   2. Single-org reality: Per system-invariants.mdc, multi-org is
--      "not yet supported" — virtually all users belong to exactly one org.
--   3. Deterministic: ORDER BY created_at ASC ensures reproducible results
--      for the rare multi-org case (always checks the oldest-joined org).
--   4. Conservative: If the oldest org lacks access, the user is denied
--      even if a newer org has access. This is the safer failure mode for
--      a paywall (deny rather than allow via an implicit secondary org).
--
-- Action:
--   No functional change — only update the COMMENT to document the deviation.
--   When multi-org switching is implemented, can_access_platform should be
--   updated to accept an explicit p_organization_id parameter and check
--   that specific org, removing the LIMIT 1 entirely.
-- =============================================================================

COMMENT ON FUNCTION public.can_access_platform IS
  'Paywall access check: returns JSONB {allowed, reason, plan, organization_id, org_type}. '
  'SECURITY DEFINER + row_security=off. '
  'Guards: auth.uid() IS NULL → {allowed:false, reason:''not_authenticated''}; '
  'no_org → {allowed:false, reason:''no_org''}. '
  'Access logic: admin_override → trial_active → subscription_active → deny. '
  'LIMIT 1 deviation (Risiko 10 — documented acceptable exception): '
  'uses oldest-joined org for paywall check. Multi-org not yet supported; '
  'when it is, add p_organization_id parameter and remove LIMIT 1. '
  'Updated 20260416: replaced digest() with sha256() (no pgcrypto). '
  'Updated 20260417: documented LIMIT 1 deviation (paywall scope, not auth context).';

DO $$
BEGIN
  RAISE NOTICE '20260417_fix_c: can_access_platform LIMIT 1 deviation documented — OK';
END $$;
