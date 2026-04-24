/**
 * Manual Billing — Profile services.
 *
 * Two profile tables backed here:
 *   * manual_billing_agency_profiles  — own legal entities (sender side)
 *   * manual_billing_counterparties   — clients OR models (sender or recipient)
 *
 * All functions are agency-org scoped via assertOrgContext + RLS. Owner+booker
 * can read/write; only owner can delete (RLS-enforced).
 *
 * Async contract (cursorrules §4c — Option A): no throws on normal-flow errors;
 * mutating ops return boolean, list ops return [], single-fetch returns null.
 */

import { supabase } from '../../lib/supabase';
import { assertOrgContext } from '../utils/orgGuard';
import type {
  ManualBillingAgencyProfileInput,
  ManualBillingAgencyProfileRow,
  ManualBillingCounterpartyInput,
  ManualBillingCounterpartyKind,
  ManualBillingCounterpartyRow,
} from '../types/manualBillingTypes';

// ── Agency profiles ────────────────────────────────────────────────────────

/** Strip nullish keys so we don't write columns the caller didn't intend to. */
function pruneNullish<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(obj) as Array<keyof T>) {
    const v = obj[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function clearAgencyProfileDefaultExcept(
  agencyOrgId: string,
  exceptProfileId: string | null,
): Promise<boolean> {
  try {
    let q = supabase
      .from('manual_billing_agency_profiles')
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq('agency_organization_id', agencyOrgId)
      .eq('is_default', true);
    if (exceptProfileId) q = q.neq('id', exceptProfileId);
    const { error } = await q;
    if (error) {
      console.error('[clearAgencyProfileDefaultExcept] error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[clearAgencyProfileDefaultExcept] exception:', e);
    return false;
  }
}

export async function listManualAgencyBillingProfiles(
  agencyOrgId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<ManualBillingAgencyProfileRow[]> {
  if (!assertOrgContext(agencyOrgId, 'listManualAgencyBillingProfiles')) return [];
  try {
    let q = supabase
      .from('manual_billing_agency_profiles')
      .select('*')
      .eq('agency_organization_id', agencyOrgId)
      .order('is_default', { ascending: false })
      .order('legal_name', { ascending: true });
    if (!opts.includeArchived) q = q.eq('is_archived', false);
    const { data, error } = await q;
    if (error) {
      console.error('[listManualAgencyBillingProfiles] error:', error);
      return [];
    }
    return (data ?? []) as ManualBillingAgencyProfileRow[];
  } catch (e) {
    console.error('[listManualAgencyBillingProfiles] exception:', e);
    return [];
  }
}

export async function getManualAgencyBillingProfile(
  profileId: string,
): Promise<ManualBillingAgencyProfileRow | null> {
  try {
    const { data, error } = await supabase
      .from('manual_billing_agency_profiles')
      .select('*')
      .eq('id', profileId)
      .maybeSingle();
    if (error) {
      console.error('[getManualAgencyBillingProfile] error:', error);
      return null;
    }
    return (data as ManualBillingAgencyProfileRow) ?? null;
  } catch (e) {
    console.error('[getManualAgencyBillingProfile] exception:', e);
    return null;
  }
}

export async function upsertManualAgencyBillingProfile(
  agencyOrgId: string,
  payload: ManualBillingAgencyProfileInput,
  existingId?: string | null,
): Promise<{ ok: boolean; id?: string }> {
  if (!assertOrgContext(agencyOrgId, 'upsertManualAgencyBillingProfile')) {
    return { ok: false };
  }
  if (!payload.legal_name || payload.legal_name.trim() === '') {
    console.error('[upsertManualAgencyBillingProfile] legal_name required');
    return { ok: false };
  }
  try {
    const now = new Date().toISOString();

    // Auto-default: first profile for this agency becomes default.
    let wantDefault = payload.is_default === true;
    if (!existingId && !wantDefault) {
      const { count } = await supabase
        .from('manual_billing_agency_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('agency_organization_id', agencyOrgId)
        .eq('is_archived', false);
      if ((count ?? 0) === 0) wantDefault = true;
    }

    if (wantDefault) {
      const ok = await clearAgencyProfileDefaultExcept(agencyOrgId, existingId ?? null);
      if (!ok) return { ok: false };
    }

    const body = pruneNullish({
      ...payload,
      legal_name: payload.legal_name.trim(),
      is_default: wantDefault,
      default_currency: (payload.default_currency ?? 'EUR').toUpperCase(),
      updated_at: now,
    });

    if (existingId) {
      const { error } = await supabase
        .from('manual_billing_agency_profiles')
        .update(body)
        .eq('id', existingId)
        .eq('agency_organization_id', agencyOrgId);
      if (error) {
        console.error('[upsertManualAgencyBillingProfile] update error:', error);
        return { ok: false };
      }
      return { ok: true, id: existingId };
    }

    const { data, error } = await supabase
      .from('manual_billing_agency_profiles')
      .insert({ agency_organization_id: agencyOrgId, ...body })
      .select('id')
      .single();
    if (error) {
      console.error('[upsertManualAgencyBillingProfile] insert error:', error);
      return { ok: false };
    }
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    console.error('[upsertManualAgencyBillingProfile] exception:', e);
    return { ok: false };
  }
}

export async function archiveManualAgencyBillingProfile(
  agencyOrgId: string,
  profileId: string,
  archived: boolean,
): Promise<boolean> {
  if (!assertOrgContext(agencyOrgId, 'archiveManualAgencyBillingProfile')) return false;
  try {
    const update: Record<string, unknown> = {
      is_archived: archived,
      updated_at: new Date().toISOString(),
    };
    if (archived) update.is_default = false;
    const { error } = await supabase
      .from('manual_billing_agency_profiles')
      .update(update)
      .eq('id', profileId)
      .eq('agency_organization_id', agencyOrgId);
    if (error) {
      console.error('[archiveManualAgencyBillingProfile] error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[archiveManualAgencyBillingProfile] exception:', e);
    return false;
  }
}

export async function deleteManualAgencyBillingProfile(
  agencyOrgId: string,
  profileId: string,
): Promise<boolean> {
  if (!assertOrgContext(agencyOrgId, 'deleteManualAgencyBillingProfile')) return false;
  try {
    const { error } = await supabase
      .from('manual_billing_agency_profiles')
      .delete()
      .eq('id', profileId)
      .eq('agency_organization_id', agencyOrgId);
    if (error) {
      console.error('[deleteManualAgencyBillingProfile] error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[deleteManualAgencyBillingProfile] exception:', e);
    return false;
  }
}

// ── Counterparties (client + model billing profiles) ───────────────────────

export type ListCounterpartiesOptions = {
  kind?: ManualBillingCounterpartyKind;
  includeArchived?: boolean;
  search?: string;
};

export async function listManualBillingCounterparties(
  agencyOrgId: string,
  opts: ListCounterpartiesOptions = {},
): Promise<ManualBillingCounterpartyRow[]> {
  if (!assertOrgContext(agencyOrgId, 'listManualBillingCounterparties')) return [];
  try {
    let q = supabase
      .from('manual_billing_counterparties')
      .select('*')
      .eq('agency_organization_id', agencyOrgId)
      .order('legal_name', { ascending: true });

    if (opts.kind) q = q.eq('kind', opts.kind);
    if (!opts.includeArchived) q = q.eq('is_archived', false);

    const search = opts.search?.trim();
    if (search) {
      // Lightweight client-side search over the columns most useful for finding
      // a profile fast (legal name, display name, city, VAT, contact, email).
      // PostgREST's `or` with `ilike` is fine for moderate dataset sizes.
      const escaped = search.replace(/[%_,]/g, (c) => `\\${c}`);
      const term = `%${escaped}%`;
      q = q.or(
        [
          `legal_name.ilike.${term}`,
          `display_name.ilike.${term}`,
          `city.ilike.${term}`,
          `vat_number.ilike.${term}`,
          `contact_person.ilike.${term}`,
          `billing_email.ilike.${term}`,
        ].join(','),
      );
    }

    const { data, error } = await q;
    if (error) {
      console.error('[listManualBillingCounterparties] error:', error);
      return [];
    }
    return (data ?? []) as ManualBillingCounterpartyRow[];
  } catch (e) {
    console.error('[listManualBillingCounterparties] exception:', e);
    return [];
  }
}

export async function getManualBillingCounterparty(
  counterpartyId: string,
): Promise<ManualBillingCounterpartyRow | null> {
  try {
    const { data, error } = await supabase
      .from('manual_billing_counterparties')
      .select('*')
      .eq('id', counterpartyId)
      .maybeSingle();
    if (error) {
      console.error('[getManualBillingCounterparty] error:', error);
      return null;
    }
    return (data as ManualBillingCounterpartyRow) ?? null;
  } catch (e) {
    console.error('[getManualBillingCounterparty] exception:', e);
    return null;
  }
}

export async function upsertManualBillingCounterparty(
  agencyOrgId: string,
  payload: ManualBillingCounterpartyInput,
  existingId?: string | null,
): Promise<{ ok: boolean; id?: string }> {
  if (!assertOrgContext(agencyOrgId, 'upsertManualBillingCounterparty')) {
    return { ok: false };
  }
  if (!payload.legal_name || payload.legal_name.trim() === '') {
    console.error('[upsertManualBillingCounterparty] legal_name required');
    return { ok: false };
  }
  if (payload.kind !== 'client' && payload.kind !== 'model') {
    console.error('[upsertManualBillingCounterparty] invalid kind:', payload.kind);
    return { ok: false };
  }
  try {
    const now = new Date().toISOString();
    const body = pruneNullish({
      ...payload,
      legal_name: payload.legal_name.trim(),
      default_currency: (payload.default_currency ?? 'EUR').toUpperCase(),
      updated_at: now,
    });

    if (existingId) {
      const { error } = await supabase
        .from('manual_billing_counterparties')
        .update(body)
        .eq('id', existingId)
        .eq('agency_organization_id', agencyOrgId);
      if (error) {
        console.error('[upsertManualBillingCounterparty] update error:', error);
        return { ok: false };
      }
      return { ok: true, id: existingId };
    }

    const { data, error } = await supabase
      .from('manual_billing_counterparties')
      .insert({ agency_organization_id: agencyOrgId, ...body })
      .select('id')
      .single();
    if (error) {
      console.error('[upsertManualBillingCounterparty] insert error:', error);
      return { ok: false };
    }
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    console.error('[upsertManualBillingCounterparty] exception:', e);
    return { ok: false };
  }
}

export async function archiveManualBillingCounterparty(
  agencyOrgId: string,
  counterpartyId: string,
  archived: boolean,
): Promise<boolean> {
  if (!assertOrgContext(agencyOrgId, 'archiveManualBillingCounterparty')) return false;
  try {
    const { error } = await supabase
      .from('manual_billing_counterparties')
      .update({ is_archived: archived, updated_at: new Date().toISOString() })
      .eq('id', counterpartyId)
      .eq('agency_organization_id', agencyOrgId);
    if (error) {
      console.error('[archiveManualBillingCounterparty] error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[archiveManualBillingCounterparty] exception:', e);
    return false;
  }
}

export async function deleteManualBillingCounterparty(
  agencyOrgId: string,
  counterpartyId: string,
): Promise<boolean> {
  if (!assertOrgContext(agencyOrgId, 'deleteManualBillingCounterparty')) return false;
  try {
    const { error } = await supabase
      .from('manual_billing_counterparties')
      .delete()
      .eq('id', counterpartyId)
      .eq('agency_organization_id', agencyOrgId);
    if (error) {
      console.error('[deleteManualBillingCounterparty] error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[deleteManualBillingCounterparty] exception:', e);
    return false;
  }
}
