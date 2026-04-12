-- Migration: Add job_description column to option_requests
-- Purpose: Allow clients to add a role/job description when creating an option request.
--          This is shown to the model in their inbox so they can see what the booking is for.
-- Safe: nullable text column, no existing rows affected.

ALTER TABLE public.option_requests
  ADD COLUMN IF NOT EXISTS job_description TEXT;

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'option_requests'
  AND column_name = 'job_description';
