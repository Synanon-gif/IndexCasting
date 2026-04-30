/**
 * Types for the unified Invoice Overview (additive, see
 * `supabase/migrations/20261219_invoice_overview_metadata_and_unified_listing.sql`).
 *
 * Strictly read-only on the source rows; only the operator-internal tracking
 * overlay (status + short note) is mutable, and only via dedicated RPCs.
 */

export type InvoiceOverviewSourceType = 'system' | 'manual';

export type InvoiceOverviewTrackingStatus = 'open' | 'paid' | 'problem';

/**
 * Cardinal directions surfaced in the overview. `agency_to_agency` is the
 * existing platform-internal commission direction (Stripe-routed only) — kept
 * for completeness so it isn't silently dropped by the picker.
 */
export type InvoiceOverviewDirection =
  | 'agency_to_client'
  | 'agency_to_model'
  | 'model_to_agency'
  | 'agency_to_agency'
  | 'platform_to_agency'
  | 'platform_to_client';

export type InvoiceOverviewFilters = {
  year?: number | null;
  month?: number | null;
  direction?: InvoiceOverviewDirection | null;
  sourceType?: InvoiceOverviewSourceType | null;
  trackingStatus?: InvoiceOverviewTrackingStatus | null;
  search?: string | null;
  limit?: number;
  offset?: number;
};

export type InvoiceOverviewRow = {
  sourceType: InvoiceOverviewSourceType;
  sourceId: string;
  organizationId: string;
  invoiceNumber: string | null;
  direction: InvoiceOverviewDirection;
  sourceStatus: string | null;
  trackingStatus: InvoiceOverviewTrackingStatus;
  internalNote: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string;
  totalAmountCents: number;
  senderName: string | null;
  recipientName: string | null;
  clientName: string | null;
  modelName: string | null;
  referenceLabel: string | null;
  hasPaymentProblem: boolean;
  sourceCreatedAt: string | null;
  metadataUpdatedAt: string | null;
  /** Sanitized Stripe hosted invoice URL when present */
  hostedInvoiceUrl: string | null;
  /** Sanitized Stripe invoice PDF URL when present */
  invoicePdfUrl: string | null;
};
