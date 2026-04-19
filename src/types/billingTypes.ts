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

export type InvoiceType =
  | 'agency_to_client'
  | 'agency_to_agency'
  | 'platform_to_agency'
  | 'platform_to_client';

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
  // 20261123 — Stripe payment failure tracking (Phase C.3). Mirrored from
  // Stripe `invoice.payment_failed` events by the webhook. Independent from
  // the canonical `status` field (which keeps the lifecycle enum). Drives
  // the `invoice_payment_failed` Smart Attention category.
  last_stripe_failure_at: string | null;
  last_stripe_failure_reason: string | null;
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

// ─── Agency ↔ Model internal settlements (model firewall enforced via RLS) ──
//
// These rows are NEVER visible to models. They are agency-internal bookkeeping
// for model payouts / commission accounting and are intentionally separate
// from the formal `invoices` table.

export type AgencyModelSettlementStatus = 'draft' | 'recorded' | 'paid' | 'void';

export type AgencyModelSettlementRow = {
  id: string;
  organization_id: string;
  model_id: string;
  source_option_request_id: string | null;
  settlement_number: string | null;
  status: AgencyModelSettlementStatus;
  currency: string;
  gross_amount_cents: number;
  commission_amount_cents: number;
  net_amount_cents: number;
  notes: string | null;
  metadata: Record<string, unknown>;
  recorded_at: string | null;
  paid_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AgencyModelSettlementInput = {
  model_id: string;
  source_option_request_id?: string | null;
  currency?: string;
  gross_amount_cents?: number;
  commission_amount_cents?: number;
  net_amount_cents?: number;
  notes?: string | null;
  metadata?: Record<string, unknown>;
};

export type AgencyModelSettlementPatch = {
  currency?: string;
  gross_amount_cents?: number;
  commission_amount_cents?: number;
  net_amount_cents?: number;
  notes?: string | null;
  metadata?: Record<string, unknown>;
  status?: AgencyModelSettlementStatus;
  settlement_number?: string | null;
};

export type AgencyModelSettlementItemRow = {
  id: string;
  settlement_id: string;
  description: string;
  quantity: number;
  unit_amount_cents: number;
  total_amount_cents: number;
  currency: string;
  position: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AgencyModelSettlementItemInput = {
  description: string;
  quantity: number;
  unit_amount_cents: number;
  total_amount_cents?: number;
  currency?: string | null;
  position?: number;
  metadata?: Record<string, unknown>;
};

export type AgencyModelSettlementWithItems = AgencyModelSettlementRow & {
  items: AgencyModelSettlementItemRow[];
};

// ─── Agency × Client billing presets (convenience prefill, NOT canonical) ───
//
// Presets are issuer-side templates owned by an agency to speed up repeated
// invoicing for a given client organization. They are NEVER live-linked into
// invoice rows after creation — the immutable `recipient_billing_snapshot` on
// the invoice remains canonical.

export type AgencyClientBillingPresetRow = {
  id: string;
  agency_organization_id: string;
  client_organization_id: string;
  label: string | null;
  is_default: boolean;
  recipient_billing_name: string | null;
  recipient_billing_address_1: string | null;
  recipient_billing_address_2: string | null;
  recipient_billing_city: string | null;
  recipient_billing_postal_code: string | null;
  recipient_billing_state: string | null;
  recipient_billing_country: string | null;
  recipient_billing_email: string | null;
  recipient_vat_id: string | null;
  recipient_tax_id: string | null;
  default_currency: string;
  default_tax_mode: 'manual' | 'stripe_tax';
  default_tax_rate_percent: number | null;
  default_reverse_charge: boolean;
  default_payment_terms_days: number;
  default_notes: string | null;
  default_line_item_template: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AgencyClientBillingPresetInput = {
  client_organization_id: string;
  label?: string | null;
  is_default?: boolean;
  recipient_billing_name?: string | null;
  recipient_billing_address_1?: string | null;
  recipient_billing_address_2?: string | null;
  recipient_billing_city?: string | null;
  recipient_billing_postal_code?: string | null;
  recipient_billing_state?: string | null;
  recipient_billing_country?: string | null;
  recipient_billing_email?: string | null;
  recipient_vat_id?: string | null;
  recipient_tax_id?: string | null;
  default_currency?: string;
  default_tax_mode?: 'manual' | 'stripe_tax';
  default_tax_rate_percent?: number | null;
  default_reverse_charge?: boolean;
  default_payment_terms_days?: number;
  default_notes?: string | null;
  default_line_item_template?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
};

export type AgencyClientBillingPresetPatch = Partial<
  Omit<AgencyClientBillingPresetInput, 'client_organization_id'>
>;
