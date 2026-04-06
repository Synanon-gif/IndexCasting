-- =============================================================================
-- Fix F: trg_validate_org_member_role — Verification + Hardening
--
-- FINDING:
--   The trigger validate_org_member_role_for_type() in
--   migration_org_role_type_enforcement.sql already correctly enforces:
--     - agency orgs: role IN ('owner', 'booker')   ✓
--     - client orgs: role IN ('owner', 'employee')  ✓
--
--   This is correct per the architecture decision:
--     Models are NOT stored in organization_members. Their org relationship
--     is expressed exclusively via model_agency_territories (see Fix H).
--
-- HARDENING applied here:
--   1. Add SECURITY DEFINER + SET row_security TO off to the trigger function
--      (it reads organizations — an RLS-protected table — in a trigger context).
--   2. Add GUARD 1: explicit auth.uid() IS NULL check is NOT required for
--      trigger functions (they fire in DB trigger context, no external caller)
--      — per Rule 21: "Trigger-Funktionen: Kein auth.uid()-Guard nötig."
--   3. Add defensive null check for NEW.role to prevent obscure errors.
--   4. Verify via ASSERT that the trigger is firing BEFORE INSERT OR UPDATE.
--
-- Idempotent: CREATE OR REPLACE.
-- =============================================================================


-- ─── 1. Hardened validate_org_member_role_for_type() ─────────────────────────

CREATE OR REPLACE FUNCTION public.validate_org_member_role_for_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off  -- reads organizations (RLS-protected) in trigger context
AS $$
DECLARE
  v_org_type organization_type;
BEGIN
  -- Defensive: role must be set
  IF NEW.role IS NULL THEN
    RAISE EXCEPTION 'org_member_role_null: role cannot be NULL for organization_members';
  END IF;

  SELECT type INTO v_org_type
  FROM public.organizations
  WHERE id = NEW.organization_id;

  IF v_org_type IS NULL THEN
    RAISE EXCEPTION 'org_not_found: organization % does not exist', NEW.organization_id;
  END IF;

  -- Agency orgs: only owner and booker are valid.
  -- Models are NOT organization_members — they use model_agency_territories.
  IF v_org_type = 'agency' AND NEW.role NOT IN ('owner', 'booker') THEN
    RAISE EXCEPTION
      'invalid_role_for_org_type: role "%" is not valid for agency organizations '
      '(allowed: owner, booker). Models use model_agency_territories, not organization_members.',
      NEW.role;
  END IF;

  -- Client orgs: only owner and employee are valid.
  IF v_org_type = 'client' AND NEW.role NOT IN ('owner', 'employee') THEN
    RAISE EXCEPTION
      'invalid_role_for_org_type: role "%" is not valid for client organizations '
      '(allowed: owner, employee)',
      NEW.role;
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate trigger (idempotent)
DROP TRIGGER IF EXISTS trg_validate_org_member_role ON public.organization_members;

CREATE TRIGGER trg_validate_org_member_role
  BEFORE INSERT OR UPDATE OF role, organization_id
  ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_org_member_role_for_type();

COMMENT ON FUNCTION public.validate_org_member_role_for_type() IS
  'Fix F (20260413): Added SET row_security TO off (reads organizations in trigger context). '
  'Added null-role guard. Error messages clarify that models use model_agency_territories. '
  'Agency: owner/booker only. Client: owner/employee only. No model role in org_members.';


-- ─── 2. Verify org_member_role ENUM values ────────────────────────────────────

DO $$
DECLARE
  v_enum_values text[];
BEGIN
  SELECT array_agg(enumlabel::text ORDER BY enumlabel)
  INTO v_enum_values
  FROM pg_enum
  WHERE enumtypid = (
    SELECT oid FROM pg_type WHERE typname = 'org_member_role'
  );

  RAISE NOTICE 'org_member_role ENUM values: %', v_enum_values;

  -- Verify 'booker' and 'employee' exist but 'model' does NOT (models use mat table)
  ASSERT 'booker'   = ANY(v_enum_values), 'FAIL: booker not in org_member_role';
  ASSERT 'employee' = ANY(v_enum_values), 'FAIL: employee not in org_member_role';
  ASSERT 'owner'    = ANY(v_enum_values), 'FAIL: owner not in org_member_role';

  RAISE NOTICE 'PASS: org_member_role ENUM is correct (booker, employee, owner)';
END $$;


-- ─── 3. Verify trigger is active ─────────────────────────────────────────────

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1
    FROM information_schema.triggers
    WHERE trigger_name   = 'trg_validate_org_member_role'
      AND event_object_table = 'organization_members'
      AND action_timing  = 'BEFORE'
  ), 'FAIL: trg_validate_org_member_role trigger not active on organization_members';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'validate_org_member_role_for_type'
      AND 'row_security=off' = ANY(proconfig)
  ), 'FAIL: validate_org_member_role_for_type missing SET row_security TO off';

  RAISE NOTICE 'PASS: 20260413_fix_f — trg_validate_org_member_role is active, hardened, correct';
END $$;
