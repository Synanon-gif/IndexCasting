import type { InvoiceOverviewDirection, InvoiceOverviewRow } from '../types/invoiceOverviewTypes';

/** Agency-editable Stripe-routed invoice drafts (not manual_invoices). */
const AGENCY_EDITABLE_DIRECTIONS: ReadonlySet<InvoiceOverviewDirection> = new Set([
  'agency_to_client',
  'agency_to_model',
  'agency_to_agency',
]);

export function isSystemInvoiceDraftEditableByAgency(
  row: Pick<InvoiceOverviewRow, 'sourceType' | 'sourceStatus' | 'direction'>,
  variant: 'agency' | 'client',
  isOperationalMember: boolean,
): boolean {
  if (variant !== 'agency' || !isOperationalMember) return false;
  if (row.sourceType !== 'system') return false;
  if (row.sourceStatus !== 'draft') return false;
  return AGENCY_EDITABLE_DIRECTIONS.has(row.direction);
}
