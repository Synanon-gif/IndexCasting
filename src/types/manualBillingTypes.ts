/**
 * Types for the Manual Billing feature (agency-owned, additive to existing
 * Stripe-routed B2B invoices). Strictly separate from `billingTypes.ts`.
 */

export type ManualBillingCounterpartyKind = 'client' | 'model';

export type ManualInvoiceDirection = 'agency_to_client' | 'agency_to_model' | 'model_to_agency';

export type ManualInvoiceStatus = 'draft' | 'generated' | 'void';

// ── Agency profiles ────────────────────────────────────────────────────────

export type ManualBillingAgencyProfileRow = {
  id: string;
  agency_organization_id: string;

  legal_name: string;
  trading_name: string | null;

  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  postal_code: string | null;
  state: string | null;
  country_code: string | null;

  company_registration_number: string | null;
  vat_number: string | null;
  tax_number: string | null;

  phone: string | null;
  email: string | null;
  website: string | null;

  bank_name: string | null;
  bank_address: string | null;
  iban: string | null;
  bic: string | null;
  account_holder: string | null;

  default_currency: string;
  default_payment_terms_days: number;
  default_vat_treatment: string | null;
  default_reverse_charge_note: string | null;
  footer_notes: string | null;

  is_archived: boolean;
  is_default: boolean;

  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ManualBillingAgencyProfileInput = Partial<
  Omit<
    ManualBillingAgencyProfileRow,
    'id' | 'agency_organization_id' | 'created_by' | 'created_at' | 'updated_at'
  >
> & {
  legal_name: string;
};

// ── Counterparties (clients + models) ──────────────────────────────────────

export type ManualBillingCounterpartyRow = {
  id: string;
  agency_organization_id: string;

  kind: ManualBillingCounterpartyKind;

  legal_name: string;
  display_name: string | null;

  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  postal_code: string | null;
  state: string | null;
  country_code: string | null;

  vat_number: string | null;
  tax_number: string | null;
  company_registration_number: string | null;

  contact_person: string | null;
  billing_email: string | null;
  phone: string | null;

  po_number: string | null;
  ap_contact: string | null;

  bank_name: string | null;
  iban: string | null;
  bic: string | null;
  account_holder: string | null;

  default_currency: string;
  default_payment_terms_days: number;
  default_vat_treatment: string | null;
  default_invoice_note: string | null;

  default_service_charge_pct: number | null;
  default_expenses_reimbursed: boolean;
  default_travel_separate: boolean;
  default_agency_fee_separate: boolean;

  linked_organization_id: string | null;
  linked_model_id: string | null;

  notes: string | null;

  is_archived: boolean;

  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ManualBillingCounterpartyInput = Partial<
  Omit<
    ManualBillingCounterpartyRow,
    'id' | 'agency_organization_id' | 'created_by' | 'created_at' | 'updated_at'
  >
> & {
  kind: ManualBillingCounterpartyKind;
  legal_name: string;
};

// ── Invoices ───────────────────────────────────────────────────────────────

export type ManualInvoiceRow = {
  id: string;
  agency_organization_id: string;

  direction: ManualInvoiceDirection;
  status: ManualInvoiceStatus;

  invoice_number: string | null;

  sender_agency_profile_id: string | null;
  sender_counterparty_id: string | null;
  recipient_agency_profile_id: string | null;
  recipient_counterparty_id: string | null;

  sender_snapshot: Record<string, unknown> | null;
  recipient_snapshot: Record<string, unknown> | null;

  issue_date: string | null;
  supply_date: string | null;
  due_date: string | null;
  payment_terms_days: number | null;

  currency: string;

  po_number: string | null;
  buyer_reference: string | null;
  job_reference: string | null;
  booking_reference: string | null;

  subtotal_rates_cents: number;
  subtotal_expenses_cents: number;
  service_charge_cents: number;
  tax_total_cents: number;
  grand_total_cents: number;

  service_charge_pct: number | null;
  vat_breakdown: Array<{
    rate_percent: number | null;
    treatment: string | null;
    net_cents: number;
    tax_cents: number;
  }>;
  reverse_charge_applied: boolean;
  tax_note: string | null;
  invoice_notes: string | null;
  payment_instructions: string | null;
  footer_notes: string | null;

  generated_at: string | null;
  generated_by: string | null;

  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ManualInvoiceLineItemRow = {
  id: string;
  invoice_id: string;
  position: number;

  category: string | null;
  is_expense: boolean;

  description: string;
  notes: string | null;

  model_label: string | null;
  job_label: string | null;
  performed_on: string | null;

  quantity: number;
  unit: string | null;
  unit_amount_cents: number;
  net_amount_cents: number;

  tax_treatment: string | null;
  tax_rate_percent: number | null;
  tax_amount_cents: number;
  gross_amount_cents: number;

  currency: string;
  metadata: Record<string, unknown>;

  created_at: string;
  updated_at: string;
};

export type ManualInvoiceLineItemInput = {
  id?: string;
  position?: number;

  category?: string | null;
  is_expense?: boolean;

  description: string;
  notes?: string | null;

  model_label?: string | null;
  job_label?: string | null;
  performed_on?: string | null;

  quantity: number;
  unit?: string | null;
  unit_amount_cents: number;

  tax_treatment?: string | null;
  tax_rate_percent?: number | null;

  currency?: string;
  metadata?: Record<string, unknown>;
};

export type ManualInvoiceWithLines = ManualInvoiceRow & {
  line_items: ManualInvoiceLineItemRow[];
};

export type ManualInvoiceHeaderInput = {
  direction: ManualInvoiceDirection;
  sender_agency_profile_id?: string | null;
  sender_counterparty_id?: string | null;
  recipient_agency_profile_id?: string | null;
  recipient_counterparty_id?: string | null;

  invoice_number?: string | null;
  issue_date?: string | null;
  supply_date?: string | null;
  due_date?: string | null;
  payment_terms_days?: number | null;
  currency?: string;

  po_number?: string | null;
  buyer_reference?: string | null;
  job_reference?: string | null;
  booking_reference?: string | null;

  service_charge_pct?: number | null;
  reverse_charge_applied?: boolean;
  tax_note?: string | null;
  invoice_notes?: string | null;
  payment_instructions?: string | null;
  footer_notes?: string | null;
};

// ── Computed totals helper ────────────────────────────────────────────────

export type ManualInvoiceTotals = {
  subtotal_rates_cents: number;
  subtotal_expenses_cents: number;
  net_total_before_service_cents: number;
  service_charge_cents: number;
  tax_total_cents: number;
  grand_total_cents: number;
  vat_breakdown: Array<{
    rate_percent: number | null;
    treatment: string | null;
    net_cents: number;
    tax_cents: number;
  }>;
};
