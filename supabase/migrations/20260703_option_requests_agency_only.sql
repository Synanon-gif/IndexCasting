-- Add agency-only manual event fields to option_requests.
ALTER TABLE public.option_requests
  ADD COLUMN IF NOT EXISTS is_agency_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agency_event_group_id uuid REFERENCES public.agency_event_groups(id) ON DELETE SET NULL;
