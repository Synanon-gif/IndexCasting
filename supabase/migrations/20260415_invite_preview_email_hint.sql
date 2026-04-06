-- =============================================================================
-- Feature: get_invitation_preview — invited_email_hint (maskiert)
--
-- PROBLEM (Lücke 4, Invite Security Hardening):
--   get_invitation_preview gibt nicht zurück, für welche E-Mail-Adresse die
--   Einladung gilt. Nutzer können sich mit der falschen E-Mail registrieren
--   und erhalten erst beim Annehmen der Einladung eine Fehlermeldung.
--
-- FIX:
--   Neues Feld invited_email_hint (maskiert, z.B. "b***@company.com") im
--   Return-Set. So kann die App vor der Registrierung darauf hinweisen,
--   welche E-Mail-Adresse verwendet werden muss.
--
--   Maskierungslogik:
--     bob@agency.com → b***@agency.com
--     ab@x.de        → a***@x.de
--
-- Sicherheit: Das vollständige E-Mail wird NICHT zurückgegeben.
--   Die Funktion ist anon-zugänglich (öffentlicher Invite-Link), daher wird
--   nur die maskierte Version gezeigt. Kein PII-Leak durch die Maske, da
--   die Domain-Teil ohnehin aus dem Invite-Link-Kontext bekannt sein kann.
--
-- Granted to anon: Ja (öffentliche Preview ohne Login)
-- =============================================================================

-- DROP erforderlich da sich der Return-Typ ändert (neues OUT-Feld invited_email_hint)
DROP FUNCTION IF EXISTS public.get_invitation_preview(text);

CREATE OR REPLACE FUNCTION public.get_invitation_preview(p_token text)
RETURNS TABLE(
  org_name          text,
  org_type          text,
  invite_role       text,
  expires_at        timestamptz,
  invited_email_hint text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT
    o.name                                                          AS org_name,
    o.type::text                                                    AS org_type,
    i.role::text                                                    AS invite_role,
    i.expires_at                                                    AS expires_at,
    -- Maskiert: erster Buchstabe + *** + @ + Domain
    -- Beispiel: bob@agency.com → b***@agency.com
    CASE
      WHEN i.email LIKE '%@%' THEN
        left(i.email, 1) || '***@' || split_part(i.email, '@', 2)
      ELSE NULL
    END                                                             AS invited_email_hint
  FROM public.invitations i
  JOIN public.organizations o ON o.id = i.organization_id
  WHERE i.token = p_token
    AND i.status = 'pending'
    AND i.expires_at > now()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_invitation_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invitation_preview(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_invitation_preview(text) IS
  'Public preview for invitation links (anon-accessible). Returns org name, type, role, '
  'expiry and a masked email hint (first char + *** + @ + domain). '
  'Full email is never returned. '
  'Updated: invited_email_hint added (20260415, Invite Security Hardening Lücke 4). '
  'Updated: SET row_security TO off added (Risiko 4 compliance).';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_invitation_preview'),
    'FAIL: get_invitation_preview function not found';
  RAISE NOTICE 'PASS: 20260415 — get_invitation_preview now returns invited_email_hint';
END $$;
