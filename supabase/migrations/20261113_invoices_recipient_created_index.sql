-- ============================================================================
-- Billing System Evolution — Phase 5
-- 2026-11-13
--
-- Add index for "Incoming / Received invoices" inbox view:
--   - filter by recipient_organization_id (current org)
--   - chronologically ordered (newest first)
--
-- Existing idx_invoices_recipient_status covers (recipient, status) for
-- status-filtered queries but does not help unordered inbox loads.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_invoices_recipient_created
  ON public.invoices (recipient_organization_id, created_at DESC)
  WHERE recipient_organization_id IS NOT NULL;
