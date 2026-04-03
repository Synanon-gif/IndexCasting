-- Add org_id column to admin_logs for M-6 (Security Audit 2026-04)
-- Allows writeAdminLog() to record which organisation an admin action targeted.
ALTER TABLE public.admin_logs
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_admin_logs_org_id ON public.admin_logs (org_id);
