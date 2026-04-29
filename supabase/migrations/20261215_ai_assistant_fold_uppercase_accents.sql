-- =============================================================================
-- Phase 2 AI Assistant: harden model-name folding for uppercase accents
--
-- Security boundary:
--   - Read-only helper used by the existing AI Assistant model facts RPC.
--   - No data access, no writes, no service_role path, no grants changed.
--   - Scope remains enforced inside ai_read_model_visible_profile_facts before
--     matching visible own-agency models.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ai_assistant_fold_search_text(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT translate(
    lower(COALESCE(p_value, '')),
    'áàâäãåāăąçćčďđéèêëēėęěíìîïīįłñńňóòôöõøōőŕřśšșťțúùûüūůűųýÿžźż',
    'aaaaaaaaacccddeeeeeeeeiiiiiilnnnoooooooorrsssttuuuuuuuuyyzzz'
  );
$$;

COMMENT ON FUNCTION public.ai_assistant_fold_search_text(text) IS
  'AI assistant safe text folding helper for visible model-name matching. Lowercases before accent folding so uppercase diacritics such as RÉMI match Remi. Does not read data or broaden model scope.';
