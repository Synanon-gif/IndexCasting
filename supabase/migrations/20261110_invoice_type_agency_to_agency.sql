-- ============================================================================
-- Billing System Evolution — Phase 2b
-- 2026-11-10
--
-- Add 'agency_to_agency' to invoice_type enum to support commission/B2B
-- invoices between agencies (e.g. mother agency ↔ daughter agency).
--
-- Strictly additive:
--   - existing enum values remain
--   - existing RLS policies (can_user_read_invoice, owner-only writes)
--     handle the new type identically (issuer owner writes; recipient
--     org owner reads post-send)
--   - invoice_sequences partitions by (org_id, invoice_type, year) — the
--     new type automatically gets its own sequence range per agency
--   - send-invoice-via-stripe edge function is type-agnostic (no change)
-- ============================================================================

ALTER TYPE public.invoice_type ADD VALUE IF NOT EXISTS 'agency_to_agency';
