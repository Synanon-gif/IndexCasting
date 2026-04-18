-- Defense-in-depth (continuation of 20260922):
-- Some legacy option_requests rows have client_name = 'Client' (literal stub) even
-- though client_organization_name resolves to a real org name (e.g. "Client 2").
-- UI helpers that fall back to client_name then render the placeholder. This
-- migration extends the existing mirror trigger so that client_name follows the
-- canonical client_organization_name whenever client_name is empty or matches a
-- known generic placeholder ('Client', 'Agency', 'Model'). It also backfills
-- existing rows and re-runs the calendar mirror for the affected ids.

-- ---------------------------------------------------------------------------
-- 1) Extend trigger function: mirror client_name from client_organization_name
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
  v_client_name_norm text;
BEGIN
  -- Resolve client organization name when missing.
  IF NEW.client_organization_name IS NULL OR btrim(NEW.client_organization_name) = '' THEN
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

  -- Mirror client_name from client_organization_name when client_name is empty
  -- OR holds a known generic placeholder. Never overwrite a real human/company
  -- name that is not on the placeholder allowlist.
  v_client_name_norm := lower(btrim(COALESCE(NEW.client_name, '')));
  IF (NEW.client_name IS NULL
      OR btrim(NEW.client_name) = ''
      OR v_client_name_norm = ANY (ARRAY['client', 'agency', 'model']))
     AND NEW.client_organization_name IS NOT NULL
     AND btrim(NEW.client_organization_name) <> '' THEN
    NEW.client_name := btrim(NEW.client_organization_name);
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger column list extended so that client_name placeholder writes are
-- intercepted on any UPDATE that touches client_name as well.
DROP TRIGGER IF EXISTS trg_option_requests_mirror_org_names ON public.option_requests;
CREATE TRIGGER trg_option_requests_mirror_org_names
BEFORE INSERT OR UPDATE OF client_organization_id, agency_organization_id, organization_id,
                          client_organization_name, agency_organization_name, client_name
ON public.option_requests
FOR EACH ROW
EXECUTE FUNCTION public.fn_option_requests_mirror_org_names();

-- ---------------------------------------------------------------------------
-- 2) Backfill historical option_requests rows
-- ---------------------------------------------------------------------------

UPDATE public.option_requests AS orq
SET client_name = btrim(orq.client_organization_name)
WHERE orq.client_organization_name IS NOT NULL
  AND btrim(orq.client_organization_name) <> ''
  AND (
    orq.client_name IS NULL
    OR btrim(orq.client_name) = ''
    OR lower(btrim(orq.client_name)) = ANY (ARRAY['client', 'agency', 'model'])
  )
  AND orq.client_name IS DISTINCT FROM btrim(orq.client_organization_name);

-- ---------------------------------------------------------------------------
-- 3) Mirror onto calendar_entries.client_name + title for affected rows
-- ---------------------------------------------------------------------------

WITH resolved AS (
  SELECT
    ce.id  AS cal_id,
    btrim(orq.client_organization_name) AS display_name,
    ce.entry_type
  FROM public.calendar_entries ce
  JOIN public.option_requests orq ON orq.id = ce.option_request_id
  WHERE ce.option_request_id IS NOT NULL
    AND orq.client_organization_name IS NOT NULL
    AND btrim(orq.client_organization_name) <> ''
    AND (
      ce.client_name IS NULL
      OR btrim(ce.client_name) = ''
      OR lower(btrim(ce.client_name)) = ANY (ARRAY['client', 'agency', 'model'])
      OR ce.title ILIKE '%– Client'
      OR ce.title ILIKE '%- Client'
      OR ce.title ILIKE '%– Agency'
      OR ce.title ILIKE '%- Agency'
    )
)
UPDATE public.calendar_entries ce
SET
  client_name = r.display_name,
  title = CASE
    WHEN ce.entry_type = 'booking' THEN 'Job – '     || r.display_name
    WHEN ce.entry_type = 'option'  THEN 'Option – '  || r.display_name
    WHEN ce.entry_type = 'casting' THEN 'Casting – ' || r.display_name
    ELSE ce.title
  END
FROM resolved r
WHERE r.cal_id = ce.id;

-- Mirror onto user_calendar_events titles (best-effort; older rows may not
-- have source_option_request_id).
UPDATE public.user_calendar_events uce
SET title = CASE
  WHEN ce.entry_type = 'booking' THEN 'Job – '     || btrim(orq.client_organization_name)
  WHEN ce.entry_type = 'option'  THEN 'Option – '  || btrim(orq.client_organization_name)
  WHEN ce.entry_type = 'casting' THEN 'Casting – ' || btrim(orq.client_organization_name)
  ELSE uce.title
END
FROM public.calendar_entries ce
JOIN public.option_requests orq ON orq.id = ce.option_request_id
WHERE uce.source_option_request_id = orq.id
  AND orq.client_organization_name IS NOT NULL
  AND btrim(orq.client_organization_name) <> ''
  AND (
    uce.title ILIKE '%– Client'
    OR uce.title ILIKE '%- Client'
    OR uce.title ILIKE '%– Agency'
    OR uce.title ILIKE '%- Agency'
  );

COMMENT ON FUNCTION public.fn_option_requests_mirror_org_names() IS
  'Auto-fills option_requests.client_organization_name, agency_organization_name and client_name from public.organizations / canonical mirror so downstream surfaces (calendar title, model inbox, B2B chat) never fall back to the generic "Client" / "Agency" placeholder. Mirrors client_name when it is empty or holds a known placeholder value.';
