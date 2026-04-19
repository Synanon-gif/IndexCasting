/** Types for organization billing prep (B2B invoices — future). */

export type OrganizationBillingProfileRow = {
  id: string;
  organization_id: string;
  label: string | null;
  billing_name: string | null;
  billing_address_1: string | null;
  billing_address_2: string | null;
  billing_city: string | null;
  billing_postal_code: string | null;
  billing_state: string | null;
  billing_country: string | null;
  billing_email: string | null;
  vat_id: string | null;
  tax_id: string | null;
  iban: string | null;
  bic: string | null;
  bank_name: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type OrganizationBillingProfileInput = {
  label?: string | null;
  billing_name?: string | null;
  billing_address_1?: string | null;
  billing_address_2?: string | null;
  billing_city?: string | null;
  billing_postal_code?: string | null;
  billing_state?: string | null;
  billing_country?: string | null;
  billing_email?: string | null;
  vat_id?: string | null;
  tax_id?: string | null;
  iban?: string | null;
  bic?: string | null;
  bank_name?: string | null;
  is_default?: boolean;
};

export type OrganizationBillingDefaultsRow = {
  organization_id: string;
  default_commission_rate: number | null;
  default_tax_rate: number | null;
  default_currency: string;
  default_payment_terms_days: number;
  invoice_number_prefix: string | null;
  invoice_notes_template: string | null;
  reverse_charge_eligible: boolean;
  created_at: string;
  updated_at: string;
};

export type OrganizationBillingDefaultsInput = {
  default_commission_rate?: number | null;
  default_tax_rate?: number | null;
  default_currency?: string | null;
  default_payment_terms_days?: number | null;
  invoice_number_prefix?: string | null;
  invoice_notes_template?: string | null;
  reverse_charge_eligible?: boolean | null;
};

// ─── Invoices (B2B Stripe Invoicing) ────────────────────────────────────────

export type InvoiceType = 'agency_to_client' | 'platform_to_agency' | 'platform_to_client';

export type InvoiceStatus =
  | 'draft'
  | 'pending_send'
  | 'sent'
  | 'paid'
  | 'overdue'
  | 'void'
  | 'uncollectible';

export type InvoiceRow = {
  id: string;
  organization_id: string;
  recipient_organization_id: string | null;
  invoice_type: InvoiceType;
  status: InvoiceStatus;
  invoice_number: string | null;
  source_option_request_id: string | null;
  period_start: string | null;
  period_end: string | null;
  payment_provider: string;
  payment_provider_metadata: Record<string, unknown>;
  stripe_invoice_id: string | null;
  stripe_hosted_url: string | null;
  stripe_pdf_url: string | null;
  stripe_payment_intent_id: string | null;
  billing_profile_snapshot: Record<string, unknown> | null;
  recipient_billing_snapshot: Record<string, unknown> | null;
  currency: string;
  subtotal_amount_cents: number;
  tax_amount_cents: number;
  total_amount_cents: number;
  tax_rate_percent: number | null;
  tax_mode: 'manual' | 'stripe_tax';
  reverse_charge_applied: boolean;
  notes: string | null;
  due_date: string | null;
  sent_at: string | null;
  paid_at: string | null;
  created_by: string | null;
  sent_by: string | null;
  created_at: string;
  updated_at: string;
};

export type InvoiceLineItemRow = {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_amount_cents: number;
  total_amount_cents: number;
  currency: string;
  source_option_request_id: string | null;
  source_booking_event_id: string | null;
  position: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type InvoiceLineItemInput = {
  id?: string;
  description: string;
  quantity: number;
  unit_amount_cents: number;
  total_amount_cents?: number;
  currency?: string | null;
  position?: number;
  metadata?: Record<string, unknown>;
  source_option_request_id?: string | null;
};

export type InvoiceDraftPatch = {
  notes?: string | null;
  due_date?: string | null;
  currency?: string | null;
  tax_rate_percent?: number | null;
  tax_mode?: 'manual' | 'stripe_tax' | null;
  reverse_charge_applied?: boolean | null;
  recipient_organization_id?: string | null;
};

export type InvoiceWithLines = InvoiceRow & {
  line_items: InvoiceLineItemRow[];
};
