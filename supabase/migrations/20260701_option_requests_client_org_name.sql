-- Add denormalized client organization name to option_requests (like client_name).
-- Safe for Model-facing views (no commercial data).
ALTER TABLE public.option_requests
  ADD COLUMN IF NOT EXISTS client_organization_name text;
