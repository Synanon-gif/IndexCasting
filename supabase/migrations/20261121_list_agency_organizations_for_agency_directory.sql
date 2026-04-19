-- Phase B.1 (2026-11-21): Agency-to-Agency invoice recipient picker
--
-- Backend für agency_to_agency Recipient-Auswahl im InvoiceDraftEditor.
-- Bisher konnte der Picker nur Client-Organisationen anzeigen
-- (list_client_organizations_for_agency_directory). Für agency_to_agency
-- Invoices muss der Issuer auch andere Agency-Orgs sehen können — die eigene
-- Agency wird ausgeschlossen (man stellt sich nicht selbst eine Rechnung).
--
-- Pattern: kanonisch identisch zu list_client_organizations_for_agency_directory
-- (SECURITY DEFINER, row_security=off, Membership-Guard auf p_agency_id, LIMIT 100,
-- ILIKE-Search). Erlaubte Ausnahme zu System-Invariante "Multi-Tenant-Tabellen
-- caller-scoped lesen": B2B-Directory-Feature mit Membership-Gate, kein PII,
-- explizit dokumentiert (siehe .cursorrules §23 Erlaubte Exceptions).

CREATE OR REPLACE FUNCTION public.list_agency_organizations_for_agency_directory(
  p_agency_id uuid,
  p_search text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller uuid := auth.uid();
  rows_json jsonb;
  q text := coalesce(trim(p_search), '');
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- Membership-Guard: Caller muss Member einer Agency-Org mit p_agency_id sein.
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.user_id = v_caller
      AND o.type = 'agency'
      AND o.agency_id = p_agency_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_allowed');
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', x.id,
        'name', x.name,
        'organization_type', x.typ
      )
    ),
    '[]'::jsonb
  ) INTO rows_json
  FROM (
    SELECT o.id, o.name, o.type::text AS typ
    FROM public.organizations o
    WHERE o.type = 'agency'
      -- Eigene Agency ausschließen (Self-Invoice macht keinen Sinn)
      AND (o.agency_id IS NULL OR o.agency_id <> p_agency_id)
      AND (q = '' OR o.name ILIKE '%' || q || '%')
    ORDER BY o.name
    LIMIT 100
  ) x;

  RETURN jsonb_build_object('ok', true, 'rows', coalesce(rows_json, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.list_agency_organizations_for_agency_directory(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_agency_organizations_for_agency_directory(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.list_agency_organizations_for_agency_directory IS
  'Agency org members only. Returns OTHER agency organizations (id, name, organization_type) '
  'for B2B agency_to_agency invoice recipient picker. Excludes the caller''s own agency.';
