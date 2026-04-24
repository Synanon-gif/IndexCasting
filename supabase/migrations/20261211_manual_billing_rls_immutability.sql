-- ============================================================================
-- Manual Billing — RLS hardening: immutable rows after status = 'generated'
-- 2026-12-11
--
-- Members may UPDATE manual_invoices only while the row is still 'draft'
-- (draft → draft edits, draft → generated finalisation). Once 'generated',
-- only admin_all can mutate (support / break-glass).
--
-- Line items: INSERT/UPDATE/DELETE only when parent invoice is 'draft'.
-- SELECT policies unchanged.
-- ============================================================================

-- ── manual_invoices: member UPDATE (draft only on read side) ───────────────

DROP POLICY IF EXISTS "manual_invoices_member_update" ON public.manual_invoices;
CREATE POLICY "manual_invoices_member_update"
  ON public.manual_invoices
  FOR UPDATE
  TO authenticated
  USING (
    public.is_org_member(agency_organization_id)
    AND status = 'draft'
  )
  WITH CHECK (
    public.is_org_member(agency_organization_id)
    AND status IN ('draft', 'generated')
  );

-- ── manual_invoice_line_items: member DML (parent draft only) ─────────────

DROP POLICY IF EXISTS "manual_invoice_lines_member_insert" ON public.manual_invoice_line_items;
CREATE POLICY "manual_invoice_lines_member_insert"
  ON public.manual_invoice_line_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.manual_invoices i
      WHERE i.id = manual_invoice_line_items.invoice_id
        AND i.status = 'draft'
        AND public.is_org_member(i.agency_organization_id)
    )
  );

DROP POLICY IF EXISTS "manual_invoice_lines_member_update" ON public.manual_invoice_line_items;
CREATE POLICY "manual_invoice_lines_member_update"
  ON public.manual_invoice_line_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.manual_invoices i
      WHERE i.id = manual_invoice_line_items.invoice_id
        AND i.status = 'draft'
        AND public.is_org_member(i.agency_organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.manual_invoices i
      WHERE i.id = manual_invoice_line_items.invoice_id
        AND i.status = 'draft'
        AND public.is_org_member(i.agency_organization_id)
    )
  );

DROP POLICY IF EXISTS "manual_invoice_lines_member_delete" ON public.manual_invoice_line_items;
CREATE POLICY "manual_invoice_lines_member_delete"
  ON public.manual_invoice_line_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.manual_invoices i
      WHERE i.id = manual_invoice_line_items.invoice_id
        AND i.status = 'draft'
        AND public.is_org_member(i.agency_organization_id)
    )
  );

COMMENT ON POLICY "manual_invoices_member_update" ON public.manual_invoices IS
  'Agency members may update invoice headers only while status=draft; '
  'WITH CHECK allows transition to generated. Admin policy bypasses.';
