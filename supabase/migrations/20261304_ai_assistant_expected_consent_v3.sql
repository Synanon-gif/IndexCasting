-- Bump expected AI Assistant acknowledgement version after privacy/subprocessor disclosure updates.
CREATE OR REPLACE FUNCTION public.ai_assistant_expected_consent_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT 'v3_2026_ai_consent_privacy'::text;
$$;

COMMENT ON FUNCTION public.ai_assistant_expected_consent_version() IS
  'Returns the canonical consent_version string clients must acknowledge for optional AI Assistant use; bump when disclosures materially change.';
