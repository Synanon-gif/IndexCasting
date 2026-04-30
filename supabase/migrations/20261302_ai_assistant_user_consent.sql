-- AI Assistant: per-user explicit opt-in consent scoped to organization.
-- Stores no prompts, answers, emails, phones, messages, notes, files, or internal IDs beyond membership scope.

CREATE TABLE IF NOT EXISTS public.ai_assistant_user_consent (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  consent_given boolean NOT NULL DEFAULT false,
  consent_version text NOT NULL,
  consented_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id),
  CONSTRAINT ai_assistant_user_consent_version_nonempty CHECK (length(BTRIM(consent_version)) > 0)
);

COMMENT ON TABLE public.ai_assistant_user_consent IS
  'Explicit AI Assistant acceptance per authenticated user per organization (GDPR/evidence). Contains no prompts or AI responses; only consent flags/version/timestamps.';

ALTER TABLE public.ai_assistant_user_consent ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_assistant_user_consent FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON TABLE public.ai_assistant_user_consent TO authenticated;

CREATE POLICY ai_assistant_user_consent_select_own
  ON public.ai_assistant_user_consent FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY ai_assistant_user_consent_insert_member
  ON public.ai_assistant_user_consent FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = (SELECT auth.uid())
        AND om.organization_id = ai_assistant_user_consent.organization_id
    )
  );

CREATE POLICY ai_assistant_user_consent_update_own
  ON public.ai_assistant_user_consent FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = (SELECT auth.uid())
        AND om.organization_id = ai_assistant_user_consent.organization_id
    )
  );

-- Must stay in sync with app + Edge constants (deploy together when bumped).
CREATE OR REPLACE FUNCTION public.ai_assistant_expected_consent_version()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT 'v1_2026_ai_terms'::text;
$$;

REVOKE ALL ON FUNCTION public.ai_assistant_expected_consent_version() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_assistant_expected_consent_version() TO authenticated;

COMMENT ON FUNCTION public.ai_assistant_expected_consent_version() IS
  'Canonical AI Assistant terms version checked by Gate + UI. Bump all clients and Edge together.';

CREATE OR REPLACE FUNCTION public.ai_assistant_assert_consent_for_ai(p_organization_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_expected text := public.ai_assistant_expected_consent_version();
  v_ok boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF p_organization_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = v_uid
      AND om.organization_id = p_organization_id
  ) THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.ai_assistant_user_consent c
    WHERE c.user_id = v_uid
      AND c.organization_id = p_organization_id
      AND c.consent_given = true
      AND c.consent_version = v_expected
  ) INTO v_ok;

  RETURN COALESCE(v_ok, false);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_assistant_assert_consent_for_ai(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_assistant_assert_consent_for_ai(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_assistant_upsert_user_consent(p_organization_id uuid, p_consent_version text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'invalid_organization';
  END IF;

  IF NULLIF(BTRIM(p_consent_version), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_consent_version';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = v_uid
      AND om.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'not_org_member';
  END IF;

  INSERT INTO public.ai_assistant_user_consent AS c (
    user_id,
    organization_id,
    consent_given,
    consent_version,
    consented_at
  )
  VALUES (
    v_uid,
    p_organization_id,
    true,
    BTRIM(p_consent_version),
    now()
  )
  ON CONFLICT (user_id, organization_id)
  DO UPDATE SET
    consent_given = true,
    consent_version = EXCLUDED.consent_version,
    consented_at = EXCLUDED.consented_at;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_assistant_upsert_user_consent(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_assistant_upsert_user_consent(uuid, text) TO authenticated;
