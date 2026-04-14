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
