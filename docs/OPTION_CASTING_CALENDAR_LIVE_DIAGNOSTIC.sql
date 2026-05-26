-- OPTION/CASTING → CALENDAR live diagnostic (RÉMI LOVISOLO / RUBEN E)
-- Run in Supabase SQL Editor. Replace :agency_id and date window as needed.
-- Org-scoped: always filter by your agency UUID from organizations.agency_id.

-- 1) Resolve models by name (adjust ILIKE if needed)
SELECT id, name, agency_id, user_id IS NOT NULL AS has_account,
       agency_relationship_status
FROM public.models
WHERE name ILIKE '%RÉMI%' OR name ILIKE '%REMI%'
   OR name ILIKE '%RUBEN%E%'
ORDER BY name;

-- 2) MAT rows for those models (calendar read used MAT until home-agency fallback fix)
SELECT mat.model_id, m.name, mat.country_code, mat.agency_id
FROM public.model_agency_territories mat
JOIN public.models m ON m.id = mat.model_id
WHERE m.name ILIKE '%RÉMI%' OR m.name ILIKE '%REMI%'
   OR m.name ILIKE '%RUBEN%E%';

-- 3) option_requests (agency manual create = one row per model)
SELECT o.id, o.model_id, m.name, o.requested_date, o.request_type,
       o.status, o.final_status, o.model_approval, o.is_agency_only,
       o.agency_event_group_id, o.created_at
FROM public.option_requests o
JOIN public.models m ON m.id = o.model_id
WHERE m.name ILIKE '%RÉMI%' OR m.name ILIKE '%REMI%'
   OR m.name ILIKE '%RUBEN%E%'
ORDER BY o.created_at DESC
LIMIT 20;

-- 4) calendar_entries per option_request_id
SELECT ce.id, ce.option_request_id, ce.model_id, ce.date, ce.entry_type,
       ce.status, ce.created_by_agency, ce.title
FROM public.calendar_entries ce
WHERE ce.option_request_id IN (
  SELECT o.id FROM public.option_requests o
  JOIN public.models m ON m.id = o.model_id
  WHERE m.name ILIKE '%RÉMI%' OR m.name ILIKE '%REMI%'
     OR m.name ILIKE '%RUBEN%E%'
)
ORDER BY ce.date DESC;

-- 5) booking_events (agency job confirm should type=job; cancelled excluded in UI)
SELECT be.id, be.source_option_request_id, be.model_id, be.date, be.type,
       be.status, be.title
FROM public.booking_events be
WHERE be.source_option_request_id IN (
  SELECT o.id FROM public.option_requests o
  JOIN public.models m ON m.id = o.model_id
  WHERE m.name ILIKE '%RÉMI%' OR m.name ILIKE '%REMI%'
     OR m.name ILIKE '%RUBEN%E%'
)
ORDER BY be.date DESC;

-- 6) user_calendar_events (agency mirror)
SELECT uce.id, uce.source_option_request_id, uce.owner_id, uce.owner_type,
       uce.date, uce.title, uce.status
FROM public.user_calendar_events uce
WHERE uce.source_option_request_id IN (
  SELECT o.id FROM public.option_requests o
  JOIN public.models m ON m.id = o.model_id
  WHERE m.name ILIKE '%RÉMI%' OR m.name ILIKE '%REMI%'
     OR m.name ILIKE '%RUBEN%E%'
)
ORDER BY uce.date DESC;

-- 7) B2B invoice drafts (skipped when is_agency_only = true — expect none for agency-only jobs)
SELECT i.id, i.option_request_id, i.status, i.created_at
FROM public.invoices i
WHERE i.option_request_id IN (
  SELECT o.id FROM public.option_requests o
  JOIN public.models m ON m.id = o.model_id
  WHERE m.name ILIKE '%RÉMI%' OR m.name ILIKE '%REMI%'
     OR m.name ILIKE '%RUBEN%E%'
);
