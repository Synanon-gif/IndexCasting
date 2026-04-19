/**
 * Agency × Client billing presets service.
 *
 * Contract:
 *  - Option A return pattern: returns boolean / null / [] on failure; never throws in normal flow.
 *  - Owner-only writes (RLS-enforced server-side). Members may read.
 *  - Client organizations and models NEVER access these rows (RLS firewall).
 *
 * Invariants:
 *  - Presets are convenience templates owned by the issuer (agency) for repeated invoicing.
 *  - Presets are NEVER live-linked into invoice rows after creation.
 *  - The `recipient_billing_snapshot` on each invoice remains canonical and immutable.
 *  - Only one preset per (agency_organization_id, client_organization_id) may have is_default = true
 *    (enforced by partial unique index `acbp_one_default_per_pair`).
 */

import { supabase } from '../../lib/supabase';
import { assertOrgContext } from '../utils/orgGuard';
import type {
  AgencyClientBillingPresetInput,
  AgencyClientBillingPresetPatch,
  AgencyClientBillingPresetRow,
} from '../types/billingTypes';

// ─── Reads ──────────────────────────────────────────────────────────────────

/**
 * List all presets owned by an agency, optionally filtered by client_organization_id.
 * Ordered by client_organization_id then is_default DESC then label.
 */
export async function listAgencyClientBillingPresets(
  agencyOrganizationId: string,
  opts?: { clientOrganizationId?: string | null; limit?: number },
): Promise<AgencyClientBillingPresetRow[]> {
  if (!assertOrgContext(agencyOrganizationId, 'listAgencyClientBillingPresets')) return [];
  try {
    let q = supabase
      .from('agency_client_billing_presets')
      .select('*')
      .eq('agency_organization_id', agencyOrganizationId)
      .order('client_organization_id', { ascending: true })
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(opts?.limit ?? 500);
    if (opts?.clientOrganizationId) {
      q = q.eq('client_organization_id', opts.clientOrganizationId);
    }
    const { data, error } = await q;
    if (error) {
      console.error('[listAgencyClientBillingPresets] error:', error);
      return [];
    }
    return (data ?? []) as AgencyClientBillingPresetRow[];
  } catch (e) {
    console.error('[listAgencyClientBillingPresets] exception:', e);
    return [];
  }
}

/**
 * Get the default preset for an agency × client pair (if any).
 * Used by invoice draft prefill flows.
 */
export async function getDefaultPresetForClient(
  agencyOrganizationId: string,
  clientOrganizationId: string,
): Promise<AgencyClientBillingPresetRow | null> {
  if (!assertOrgContext(agencyOrganizationId, 'getDefaultPresetForClient')) return null;
  if (!clientOrganizationId) return null;
  try {
    const { data, error } = await supabase
      .from('agency_client_billing_presets')
      .select('*')
      .eq('agency_organization_id', agencyOrganizationId)
      .eq('client_organization_id', clientOrganizationId)
      .eq('is_default', true)
      .maybeSingle();
    if (error) {
      console.error('[getDefaultPresetForClient] error:', error);
      return null;
    }
    return (data as AgencyClientBillingPresetRow) ?? null;
  } catch (e) {
    console.error('[getDefaultPresetForClient] exception:', e);
    return null;
  }
}

export async function getAgencyClientBillingPreset(
  presetId: string,
): Promise<AgencyClientBillingPresetRow | null> {
  if (!presetId) return null;
  try {
    const { data, error } = await supabase
      .from('agency_client_billing_presets')
      .select('*')
      .eq('id', presetId)
      .maybeSingle();
    if (error) {
      console.error('[getAgencyClientBillingPreset] error:', error);
      return null;
    }
    return (data as AgencyClientBillingPresetRow) ?? null;
  } catch (e) {
    console.error('[getAgencyClientBillingPreset] exception:', e);
    return null;
  }
}

// ─── Owner writes ───────────────────────────────────────────────────────────

/**
 * Clears is_default on all sibling presets for the same (agency, client) pair,
 * optionally except one id. Used before flipping is_default = true on a preset.
 */
async function clearDefaultExcept(
  agencyOrganizationId: string,
  clientOrganizationId: string,
  exceptPresetId: string | null,
): Promise<boolean> {
  try {
    let q = supabase
      .from('agency_client_billing_presets')
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq('agency_organization_id', agencyOrganizationId)
      .eq('client_organization_id', clientOrganizationId)
      .eq('is_default', true);
    if (exceptPresetId) {
      q = q.neq('id', exceptPresetId);
    }
    const { error } = await q;
    if (error) {
      console.error('[acbp.clearDefaultExcept] error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[acbp.clearDefaultExcept] exception:', e);
    return false;
  }
}

/**
 * Create a new preset for the (agency, client) pair. Owner-only (RLS).
 * Returns the new preset id, or null on error.
 *
 * If `is_default` is true (or this is the first preset for the pair), siblings
 * are flipped to false first to satisfy the partial unique index.
 */
export async function createAgencyClientBillingPreset(
  agencyOrganizationId: string,
  payload: AgencyClientBillingPresetInput,
): Promise<string | null> {
  if (!assertOrgContext(agencyOrganizationId, 'createAgencyClientBillingPreset')) return null;
  if (!payload.client_organization_id) {
    console.error('[createAgencyClientBillingPreset] client_organization_id required');
    return null;
  }
  try {
    const { count, error: countErr } = await supabase
      .from('agency_client_billing_presets')
      .select('id', { count: 'exact', head: true })
      .eq('agency_organization_id', agencyOrganizationId)
      .eq('client_organization_id', payload.client_organization_id);
    if (countErr) {
      console.error('[createAgencyClientBillingPreset] count error:', countErr);
      return null;
    }
    const wantDefault = payload.is_default === true || (count ?? 0) === 0;
    if (wantDefault) {
      const ok = await clearDefaultExcept(
        agencyOrganizationId,
        payload.client_organization_id,
        null,
      );
      if (!ok) return null;
    }
    const { data, error } = await supabase
      .from('agency_client_billing_presets')
      .insert({
        agency_organization_id: agencyOrganizationId,
        client_organization_id: payload.client_organization_id,
        label: payload.label ?? null,
        is_default: wantDefault,
        recipient_billing_name: payload.recipient_billing_name ?? null,
        recipient_billing_address_1: payload.recipient_billing_address_1 ?? null,
        recipient_billing_address_2: payload.recipient_billing_address_2 ?? null,
        recipient_billing_city: payload.recipient_billing_city ?? null,
        recipient_billing_postal_code: payload.recipient_billing_postal_code ?? null,
        recipient_billing_state: payload.recipient_billing_state ?? null,
        recipient_billing_country: payload.recipient_billing_country ?? null,
        recipient_billing_email: payload.recipient_billing_email ?? null,
        recipient_vat_id: payload.recipient_vat_id ?? null,
        recipient_tax_id: payload.recipient_tax_id ?? null,
        default_currency: payload.default_currency ?? 'EUR',
        default_tax_mode: payload.default_tax_mode ?? 'manual',
        default_tax_rate_percent: payload.default_tax_rate_percent ?? null,
        default_reverse_charge: payload.default_reverse_charge ?? false,
        default_payment_terms_days: payload.default_payment_terms_days ?? 30,
        default_notes: payload.default_notes ?? null,
        default_line_item_template: payload.default_line_item_template ?? [],
        metadata: payload.metadata ?? {},
      })
      .select('id')
      .single();
    if (error) {
      console.error('[createAgencyClientBillingPreset] insert error:', error);
      return null;
    }
    return (data?.id as string) ?? null;
  } catch (e) {
    console.error('[createAgencyClientBillingPreset] exception:', e);
    return null;
  }
}

/**
 * Update editable fields on an existing preset. Owner-only (RLS).
 * If `is_default` flips to true, siblings are flipped to false first.
 */
export async function updateAgencyClientBillingPreset(
  presetId: string,
  agencyOrganizationId: string,
  patch: AgencyClientBillingPresetPatch,
): Promise<boolean> {
  if (!presetId) return false;
  if (!assertOrgContext(agencyOrganizationId, 'updateAgencyClientBillingPreset')) return false;
  try {
    const update: Record<string, unknown> = {};
    if (patch.label !== undefined) update.label = patch.label;
    if (patch.recipient_billing_name !== undefined) {
      update.recipient_billing_name = patch.recipient_billing_name;
    }
    if (patch.recipient_billing_address_1 !== undefined) {
      update.recipient_billing_address_1 = patch.recipient_billing_address_1;
    }
    if (patch.recipient_billing_address_2 !== undefined) {
      update.recipient_billing_address_2 = patch.recipient_billing_address_2;
    }
    if (patch.recipient_billing_city !== undefined) {
      update.recipient_billing_city = patch.recipient_billing_city;
    }
    if (patch.recipient_billing_postal_code !== undefined) {
      update.recipient_billing_postal_code = patch.recipient_billing_postal_code;
    }
    if (patch.recipient_billing_state !== undefined) {
      update.recipient_billing_state = patch.recipient_billing_state;
    }
    if (patch.recipient_billing_country !== undefined) {
      update.recipient_billing_country = patch.recipient_billing_country;
    }
    if (patch.recipient_billing_email !== undefined) {
      update.recipient_billing_email = patch.recipient_billing_email;
    }
    if (patch.recipient_vat_id !== undefined) update.recipient_vat_id = patch.recipient_vat_id;
    if (patch.recipient_tax_id !== undefined) update.recipient_tax_id = patch.recipient_tax_id;
    if (patch.default_currency !== undefined) {
      update.default_currency = patch.default_currency ?? 'EUR';
    }
    if (patch.default_tax_mode !== undefined) {
      update.default_tax_mode = patch.default_tax_mode ?? 'manual';
    }
    if (patch.default_tax_rate_percent !== undefined) {
      update.default_tax_rate_percent = patch.default_tax_rate_percent;
    }
    if (patch.default_reverse_charge !== undefined) {
      update.default_reverse_charge = patch.default_reverse_charge;
    }
    if (patch.default_payment_terms_days !== undefined) {
      update.default_payment_terms_days = patch.default_payment_terms_days;
    }
    if (patch.default_notes !== undefined) update.default_notes = patch.default_notes;
    if (patch.default_line_item_template !== undefined) {
      update.default_line_item_template = patch.default_line_item_template;
    }
    if (patch.metadata !== undefined) update.metadata = patch.metadata;

    if (patch.is_default === true) {
      const { data: existing, error: readErr } = await supabase
        .from('agency_client_billing_presets')
        .select('client_organization_id')
        .eq('id', presetId)
        .maybeSingle();
      if (readErr) {
        console.error('[updateAgencyClientBillingPreset] lookup error:', readErr);
        return false;
      }
      const clientOrgId = (existing as { client_organization_id?: string } | null)
        ?.client_organization_id;
      if (clientOrgId) {
        const ok = await clearDefaultExcept(agencyOrganizationId, clientOrgId, presetId);
        if (!ok) return false;
      }
      update.is_default = true;
    } else if (patch.is_default === false) {
      update.is_default = false;
    }

    if (Object.keys(update).length === 0) return true;
    const { error } = await supabase
      .from('agency_client_billing_presets')
      .update(update)
      .eq('id', presetId)
      .eq('agency_organization_id', agencyOrganizationId);
    if (error) {
      console.error('[updateAgencyClientBillingPreset] update error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[updateAgencyClientBillingPreset] exception:', e);
    return false;
  }
}

export async function deleteAgencyClientBillingPreset(
  presetId: string,
  agencyOrganizationId: string,
): Promise<boolean> {
  if (!presetId) return false;
  if (!assertOrgContext(agencyOrganizationId, 'deleteAgencyClientBillingPreset')) return false;
  try {
    const { error } = await supabase
      .from('agency_client_billing_presets')
      .delete()
      .eq('id', presetId)
      .eq('agency_organization_id', agencyOrganizationId);
    if (error) {
      console.error('[deleteAgencyClientBillingPreset] error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[deleteAgencyClientBillingPreset] exception:', e);
    return false;
  }
}
