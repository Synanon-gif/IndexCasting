-- Bump canonical AI Assistant consent version (substantive disclosure text change).
-- Deploy with app + Edge `consentGate.ts` + `src/constants/aiAssistantConsent.ts`.

CREATE OR REPLACE FUNCTION public.ai_assistant_expected_consent_version()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT 'v2_2026_ai_consent'::text;
$$;
