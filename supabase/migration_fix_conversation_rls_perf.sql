-- =============================================================================
-- MED-3: conversation_accessible_to_me() – SET row_security TO off
--
-- Problem: Die Funktion fehlte SET row_security TO off. Bei jeder Message-
--   Zeile entstand eine 3-Level-RLS-Kette:
--     messages RLS
--       → conversation_accessible_to_me()    (SECURITY DEFINER, aber row_security ON)
--         → organization_members RLS
--           → user_is_member_of_organization() (SECURITY DEFINER, row_security OFF)
--
--   Das erzeugt erheblichen Query-Overhead, besonders bei fetchAllSupabasePages.
--   Bei Supabase Realtime mit vielen Subscriptions ist das ein Engpass.
--
-- Fix: SET row_security TO off ergänzen (analog zu user_is_member_of_organization).
--   Die Funktion ist SECURITY DEFINER, läuft als postgres/Owner und prüft
--   auth.uid() selbst — row_security off ist hier sicher.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.conversation_accessible_to_me(p_conv_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conv_id
      AND (
        auth.uid() = ANY (c.participant_ids)
        OR (
          c.client_organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organization_members m
            WHERE m.organization_id = c.client_organization_id
              AND m.user_id = auth.uid()
          )
        )
        OR (
          c.agency_organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organization_members m
            WHERE m.organization_id = c.agency_organization_id
              AND m.user_id = auth.uid()
          )
        )
      )
  );
$$;

ALTER FUNCTION public.conversation_accessible_to_me(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.conversation_accessible_to_me(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conversation_accessible_to_me(uuid) TO authenticated;

COMMENT ON FUNCTION public.conversation_accessible_to_me(uuid) IS
  'Returns true when auth.uid() may access the given conversation: '
  'either as participant, or as member of the linked client/agency organisation. '
  'row_security=off avoids the recursive RLS chain on organization_members.';
