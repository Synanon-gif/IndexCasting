import { supabase } from '../../lib/supabase';
import { assertOrgContext } from '../utils/orgGuard';
import type {
  OrganizationBillingDefaultsInput,
  OrganizationBillingDefaultsRow,
  OrganizationBillingProfileInput,
  OrganizationBillingProfileRow,
} from '../types/billingTypes';

/** Clears is_default on all rows for org, optionally except one id (use null for “clear all”). */
async function clearDefaultExcept(
  organizationId: string,
  exceptProfileId: string | null,
): Promise<boolean> {
  try {
    let q = supabase
      .from('organization_billing_profiles')
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq('organization_id', organizationId)
      .eq('is_default', true);
    if (exceptProfileId) {
      q = q.neq('id', exceptProfileId);
    }
    const { error } = await q;
    if (error) {
      console.error('[clearDefaultExcept] error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[clearDefaultExcept] exception:', e);
    return false;
  }
}

/**
 * List billing profiles for an organization (org member readable per RLS).
 */
export async function listOrganizationBillingProfiles(
  organizationId: string,
): Promise<OrganizationBillingProfileRow[]> {
  if (!assertOrgContext(organizationId, 'listOrganizationBillingProfiles')) return [];
  try {
    const { data, error } = await supabase
      .from('organization_billing_profiles')
      .select('*')
      .eq('organization_id', organizationId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) {
      console.error('[listOrganizationBillingProfiles] error:', error);
      return [];
    }
    return (data ?? []) as OrganizationBillingProfileRow[];
  } catch (e) {
    console.error('[listOrganizationBillingProfiles] exception:', e);
    return [];
  }
}

/**
 * Insert or update a billing profile. Owner-only (RLS).
 * First profile for an org becomes default. Setting is_default true clears others.
 */
export async function upsertOrganizationBillingProfile(
  organizationId: string,
  payload: OrganizationBillingProfileInput,
  existingId?: string | null,
): Promise<boolean> {
  if (!assertOrgContext(organizationId, 'upsertOrganizationBillingProfile')) return false;
  try {
    const now = new Date().toISOString();

    const { count, error: countErr } = await supabase
      .from('organization_billing_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId);

    if (countErr) {
      console.error('[upsertOrganizationBillingProfile] count error:', countErr);
      return false;
    }

    const rowCount = count ?? 0;
    const wantDefault = payload.is_default === true || (rowCount === 0 && !existingId);

    if (wantDefault) {
      const ok = await clearDefaultExcept(organizationId, existingId ?? null);
      if (!ok) return false;
    }

    const rowBody = {
      label: payload.label ?? null,
      billing_name: payload.billing_name ?? null,
      billing_address_1: payload.billing_address_1 ?? null,
      billing_address_2: payload.billing_address_2 ?? null,
      billing_city: payload.billing_city ?? null,
      billing_postal_code: payload.billing_postal_code ?? null,
      billing_state: payload.billing_state ?? null,
      billing_country: payload.billing_country ?? null,
      billing_email: payload.billing_email ?? null,
      vat_id: payload.vat_id ?? null,
      tax_id: payload.tax_id ?? null,
      iban: payload.iban ?? null,
      bic: payload.bic ?? null,
      bank_name: payload.bank_name ?? null,
      is_default: wantDefault,
      updated_at: now,
    };

    if (existingId) {
      const { error } = await supabase
        .from('organization_billing_profiles')
        .update(rowBody)
        .eq('id', existingId)
        .eq('organization_id', organizationId);
      if (error) {
        console.error('[upsertOrganizationBillingProfile] update error:', error);
        return false;
      }
      return true;
    }

    const { error } = await supabase.from('organization_billing_profiles').insert({
      organization_id: organizationId,
      ...rowBody,
    });
    if (error) {
      console.error('[upsertOrganizationBillingProfile] insert error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[upsertOrganizationBillingProfile] exception:', e);
    return false;
  }
}

export async function deleteOrganizationBillingProfile(
  organizationId: string,
  profileId: string,
): Promise<boolean> {
  if (!assertOrgContext(organizationId, 'deleteOrganizationBillingProfile')) return false;
  try {
    const { error } = await supabase
      .from('organization_billing_profiles')
      .delete()
      .eq('id', profileId)
      .eq('organization_id', organizationId);
    if (error) {
      console.error('[deleteOrganizationBillingProfile] error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[deleteOrganizationBillingProfile] exception:', e);
    return false;
  }
}

export async function getOrganizationBillingDefaults(
  organizationId: string,
): Promise<OrganizationBillingDefaultsRow | null> {
  if (!assertOrgContext(organizationId, 'getOrganizationBillingDefaults')) return null;
  try {
    const { data, error } = await supabase
      .from('organization_billing_defaults')
      .select('*')
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error) {
      console.error('[getOrganizationBillingDefaults] error:', error);
      return null;
    }
    return (data as OrganizationBillingDefaultsRow) ?? null;
  } catch (e) {
    console.error('[getOrganizationBillingDefaults] exception:', e);
    return null;
  }
}

export async function upsertOrganizationBillingDefaults(
  organizationId: string,
  payload: OrganizationBillingDefaultsInput,
): Promise<boolean> {
  if (!assertOrgContext(organizationId, 'upsertOrganizationBillingDefaults')) return false;
  try {
    const now = new Date().toISOString();
    const row = {
      organization_id: organizationId,
      default_commission_rate: payload.default_commission_rate ?? null,
      default_tax_rate: payload.default_tax_rate ?? null,
      default_currency: payload.default_currency ?? 'EUR',
      default_payment_terms_days: payload.default_payment_terms_days ?? 30,
      invoice_number_prefix: payload.invoice_number_prefix ?? null,
      invoice_notes_template: payload.invoice_notes_template ?? null,
      reverse_charge_eligible: payload.reverse_charge_eligible ?? false,
      updated_at: now,
    };

    const { data: exists } = await supabase
      .from('organization_billing_defaults')
      .select('organization_id')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (exists) {
      const { error } = await supabase
        .from('organization_billing_defaults')
        .update(row)
        .eq('organization_id', organizationId);
      if (error) {
        console.error('[upsertOrganizationBillingDefaults] update error:', error);
        return false;
      }
      return true;
    }

    const { error } = await supabase.from('organization_billing_defaults').insert({
      ...row,
      created_at: now,
    });
    if (error) {
      console.error('[upsertOrganizationBillingDefaults] insert error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[upsertOrganizationBillingDefaults] exception:', e);
    return false;
  }
}
