-- Defense-in-depth: ensure option_requests always has the canonical organization
-- display name mirrored, regardless of whether the calling service supplied it.
--
-- Background: client_organization_name was optional in the insert payload and
-- agency_organization_name was never set by the frontend at all. Legacy rows
-- therefore have NULL mirrors even when valid client_organization_id /
-- agency_organization_id foreign keys exist, which causes downstream surfaces
-- (calendar titles, model inbox header, B2B chat label) to fall back to the
-- generic "Client" placeholder.
--
-- This migration:
--   1) installs a BEFORE INSERT/UPDATE trigger that resolves the names from
--      public.organizations whenever the mirror columns are NULL but a usable
--      foreign key is available (organization_id, client_organization_id, or
--      agency_organization_id);
--   2) backfills historical rows with the same logic;
--   3) re-runs the calendar-title backfill from 20260921 so existing
--      calendar_entries pick up the freshly populated names.

-- ---------------------------------------------------------------------------
-- 1) Trigger function + trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_option_requests_mirror_org_names()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_client_org_id uuid;
  v_agency_org_id uuid;
  v_resolved text;
BEGIN
  -- Resolve client organization name when missing.
  IF NEW.client_organization_name IS NULL OR btrim(NEW.client_organization_name) = '' THEN
    -- Prefer client_organization_id, fall back to legacy organization_id (which
    -- historically held the client org id for client-driven option requests).
    v_client_org_id := COALESCE(NEW.client_organization_id, NEW.organization_id);
    IF v_client_org_id IS NOT NULL THEN
      SELECT NULLIF(btrim(o.name), '')
        INTO v_resolved
        FROM public.organizations o
       WHERE o.id = v_client_org_id;
      IF v_resolved IS NOT NULL THEN
        NEW.client_organization_name := v_resolved;
      END IF;
    END IF;
  END IF;

  -- Resolve agency organization name when missing.
  IF NEW.agency_organization_name IS NULL OR btrim(NEW.agency_organization_name) = '' THEN
    v_agency_org_id := NEW.agency_organization_id;
    IF v_agency_org_id IS NOT NULL THEN
      SELECT NULLIF(btrim(o.name), '')
        INTO v_resolved
        FROM public.organizations o
       WHERE o.id = v_agency_org_id;
      IF v_resolved IS NOT NULL THEN
        NEW.agency_organization_name := v_resolved;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_option_requests_mirror_org_names ON public.option_requests;
CREATE TRIGGER trg_option_requests_mirror_org_names
BEFORE INSERT OR UPDATE OF client_organization_id, agency_organization_id, organization_id,
                          client_organization_name, agency_organization_name
ON public.option_requests
FOR EACH ROW
EXECUTE FUNCTION public.fn_option_requests_mirror_org_names();

-- ---------------------------------------------------------------------------
-- 2) Backfill historical rows
-- ---------------------------------------------------------------------------

UPDATE public.option_requests AS orq
SET client_organization_name = NULLIF(btrim(o.name), '')
FROM public.organizations o
WHERE (orq.client_organization_name IS NULL OR btrim(orq.client_organization_name) = '')
  AND o.id = COALESCE(orq.client_organization_id, orq.organization_id)
  AND COALESCE(orq.client_organization_id, orq.organization_id) IS NOT NULL
  AND NULLIF(btrim(o.name), '') IS NOT NULL;

UPDATE public.option_requests AS orq
SET agency_organization_name = NULLIF(btrim(o.name), '')
FROM public.organizations o
WHERE (orq.agency_organization_name IS NULL OR btrim(orq.agency_organization_name) = '')
  AND o.id = orq.agency_organization_id
  AND orq.agency_organization_id IS NOT NULL
  AND NULLIF(btrim(o.name), '') IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Re-run calendar title/client_name backfill (mirrors logic from 20260921)
--    so existing calendar entries pick up the freshly populated org names.
-- ---------------------------------------------------------------------------

WITH resolved AS (
  SELECT
    ce.id  AS cal_id,
    NULLIF(btrim(COALESCE(orq.client_organization_name,
                          orq.agency_organization_name,
                          orq.client_name)), '') AS display_name,
    ce.entry_type,
    ce.title AS old_title,
    ce.client_name AS old_client_name,
    orq.is_agency_only
  FROM public.calendar_entries ce
  JOIN public.option_requests orq ON orq.id = ce.option_request_id
  WHERE ce.option_request_id IS NOT NULL
)
UPDATE public.calendar_entries ce
SET
  client_name = COALESCE(r.display_name, ce.client_name),
  title = CASE
    WHEN r.display_name IS NULL THEN ce.title
    WHEN ce.entry_type = 'booking' THEN 'Job – ' || r.display_name
    WHEN ce.entry_type = 'option' THEN 'Option – ' || r.display_name
    WHEN ce.entry_type = 'casting' THEN 'Casting – ' || r.display_name
    ELSE ce.title
  END
FROM resolved r
WHERE r.cal_id = ce.id
  AND r.display_name IS NOT NULL
  AND (
    ce.client_name IS DISTINCT FROM r.display_name
    OR (ce.entry_type = 'booking' AND ce.title IS DISTINCT FROM 'Job – ' || r.display_name)
    OR (ce.entry_type = 'option'  AND ce.title IS DISTINCT FROM 'Option – ' || r.display_name)
    OR (ce.entry_type = 'casting' AND ce.title IS DISTINCT FROM 'Casting – ' || r.display_name)
  );

-- Mirror onto user_calendar_events titles if they exist (best-effort; older
-- rows may not have source_option_request_id).
UPDATE public.user_calendar_events uce
SET title = CASE
  WHEN ce.entry_type = 'booking' THEN 'Job – ' || NULLIF(btrim(orq.client_organization_name), '')
  WHEN ce.entry_type = 'option'  THEN 'Option – ' || NULLIF(btrim(orq.client_organization_name), '')
  WHEN ce.entry_type = 'casting' THEN 'Casting – ' || NULLIF(btrim(orq.client_organization_name), '')
  ELSE uce.title
END
FROM public.calendar_entries ce
JOIN public.option_requests orq ON orq.id = ce.option_request_id
WHERE uce.source_option_request_id = orq.id
  AND NULLIF(btrim(orq.client_organization_name), '') IS NOT NULL
  AND (
    (ce.entry_type = 'booking' AND uce.title IS DISTINCT FROM 'Job – '   || orq.client_organization_name) OR
    (ce.entry_type = 'option'  AND uce.title IS DISTINCT FROM 'Option – '|| orq.client_organization_name) OR
    (ce.entry_type = 'casting' AND uce.title IS DISTINCT FROM 'Casting – '|| orq.client_organization_name)
  );

COMMENT ON FUNCTION public.fn_option_requests_mirror_org_names() IS
  'Auto-fills option_requests.client_organization_name and agency_organization_name from public.organizations when the mirror columns are NULL but a foreign key (client_organization_id / organization_id / agency_organization_id) is present. Defense-in-depth so downstream surfaces (calendar title, model inbox, B2B chat) never fall back to the generic "Client" placeholder.';
