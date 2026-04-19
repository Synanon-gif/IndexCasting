/**
 * Agency ↔ Model internal settlements service.
 *
 * Contract:
 * - Option A return pattern: returns boolean / null / [] on failure; never throws in normal flow.
 * - Owner-only writes (RLS-enforced server-side). Members may read.
 * - Models NEVER read or write here (RLS firewall).
 *
 * Invariants:
 * - These rows are agency-internal bookkeeping for model payouts/commissions.
 * - They are NOT formal invoices and never appear in the `invoices` table.
 * - Model firewall: agency_model_settlements RLS denies all access to linked model users.
 * - Items recompute parent totals (gross/net) on add/update/delete, similar to invoices.
 */

import { supabase } from '../../lib/supabase';
import { assertOrgContext } from '../utils/orgGuard';
import type {
  AgencyModelSettlementInput,
  AgencyModelSettlementItemInput,
  AgencyModelSettlementItemRow,
  AgencyModelSettlementPatch,
  AgencyModelSettlementRow,
  AgencyModelSettlementStatus,
  AgencyModelSettlementWithItems,
} from '../types/billingTypes';

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function listAgencyModelSettlements(
  organizationId: string,
  opts?: {
    statuses?: AgencyModelSettlementStatus[];
    modelId?: string | null;
    limit?: number;
  },
): Promise<AgencyModelSettlementRow[]> {
  if (!assertOrgContext(organizationId, 'listAgencyModelSettlements')) return [];
  try {
    let q = supabase
      .from('agency_model_settlements')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 200);
    if (opts?.statuses?.length) q = q.in('status', opts.statuses);
    if (opts?.modelId) q = q.eq('model_id', opts.modelId);
    const { data, error } = await q;
    if (error) {
      console.error('[listAgencyModelSettlements] error:', error);
      return [];
    }
    return (data ?? []) as AgencyModelSettlementRow[];
  } catch (e) {
    console.error('[listAgencyModelSettlements] exception:', e);
    return [];
  }
}

export async function getAgencyModelSettlementWithItems(
  settlementId: string,
): Promise<AgencyModelSettlementWithItems | null> {
  if (!settlementId) return null;
  try {
    const { data: settlement, error: sErr } = await supabase
      .from('agency_model_settlements')
      .select('*')
      .eq('id', settlementId)
      .maybeSingle();
    if (sErr) {
      console.error('[getAgencyModelSettlementWithItems] settlement error:', sErr);
      return null;
    }
    if (!settlement) return null;
    const { data: items, error: iErr } = await supabase
      .from('agency_model_settlement_items')
      .select('*')
      .eq('settlement_id', settlementId)
      .order('position', { ascending: true });
    if (iErr) {
      console.error('[getAgencyModelSettlementWithItems] items error:', iErr);
      return null;
    }
    return {
      ...(settlement as AgencyModelSettlementRow),
      items: (items ?? []) as AgencyModelSettlementItemRow[],
    };
  } catch (e) {
    console.error('[getAgencyModelSettlementWithItems] exception:', e);
    return null;
  }
}

// ─── Owner writes (RLS enforces ownership server-side) ──────────────────────

export async function createAgencyModelSettlement(
  organizationId: string,
  payload: AgencyModelSettlementInput,
): Promise<string | null> {
  if (!assertOrgContext(organizationId, 'createAgencyModelSettlement')) return null;
  if (!payload.model_id) {
    console.error('[createAgencyModelSettlement] model_id required');
    return null;
  }
  try {
    const { data, error } = await supabase
      .from('agency_model_settlements')
      .insert({
        organization_id: organizationId,
        model_id: payload.model_id,
        source_option_request_id: payload.source_option_request_id ?? null,
        status: 'draft',
        currency: payload.currency ?? 'EUR',
        gross_amount_cents: payload.gross_amount_cents ?? 0,
        commission_amount_cents: payload.commission_amount_cents ?? 0,
        net_amount_cents: payload.net_amount_cents ?? 0,
        notes: payload.notes ?? null,
        metadata: payload.metadata ?? {},
      })
      .select('id')
      .single();
    if (error) {
      console.error('[createAgencyModelSettlement] error:', error);
      return null;
    }
    return (data?.id as string) ?? null;
  } catch (e) {
    console.error('[createAgencyModelSettlement] exception:', e);
    return null;
  }
}

/** Update editable fields on a settlement row. RLS: owner only. */
export async function updateAgencyModelSettlement(
  settlementId: string,
  organizationId: string,
  patch: AgencyModelSettlementPatch,
): Promise<boolean> {
  if (!settlementId) return false;
  if (!assertOrgContext(organizationId, 'updateAgencyModelSettlement')) return false;
  try {
    const update: Record<string, unknown> = {};
    if (patch.currency !== undefined) update.currency = patch.currency ?? 'EUR';
    if (patch.gross_amount_cents !== undefined)
      update.gross_amount_cents = patch.gross_amount_cents;
    if (patch.commission_amount_cents !== undefined) {
      update.commission_amount_cents = patch.commission_amount_cents;
    }
    if (patch.net_amount_cents !== undefined) update.net_amount_cents = patch.net_amount_cents;
    if (patch.notes !== undefined) update.notes = patch.notes;
    if (patch.metadata !== undefined) update.metadata = patch.metadata;
    if (patch.settlement_number !== undefined) update.settlement_number = patch.settlement_number;
    if (patch.status !== undefined) {
      update.status = patch.status;
      if (patch.status === 'recorded') update.recorded_at = new Date().toISOString();
      if (patch.status === 'paid') update.paid_at = new Date().toISOString();
    }
    if (Object.keys(update).length === 0) return true;
    const { error } = await supabase
      .from('agency_model_settlements')
      .update(update)
      .eq('id', settlementId)
      .eq('organization_id', organizationId);
    if (error) {
      console.error('[updateAgencyModelSettlement] error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[updateAgencyModelSettlement] exception:', e);
    return false;
  }
}

export async function markAgencyModelSettlementPaid(
  settlementId: string,
  organizationId: string,
): Promise<boolean> {
  return updateAgencyModelSettlement(settlementId, organizationId, { status: 'paid' });
}

/** Delete a draft settlement (RLS: owner only, status='draft' only). */
export async function deleteAgencyModelSettlement(
  settlementId: string,
  organizationId: string,
): Promise<boolean> {
  if (!settlementId) return false;
  if (!assertOrgContext(organizationId, 'deleteAgencyModelSettlement')) return false;
  try {
    const { error } = await supabase
      .from('agency_model_settlements')
      .delete()
      .eq('id', settlementId)
      .eq('organization_id', organizationId)
      .eq('status', 'draft');
    if (error) {
      console.error('[deleteAgencyModelSettlement] error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[deleteAgencyModelSettlement] exception:', e);
    return false;
  }
}

// ─── Items ──────────────────────────────────────────────────────────────────

export async function addAgencyModelSettlementItem(
  settlementId: string,
  item: AgencyModelSettlementItemInput,
): Promise<string | null> {
  if (!settlementId) return null;
  try {
    const total = item.total_amount_cents ?? Math.round(item.quantity * item.unit_amount_cents);
    const { data, error } = await supabase
      .from('agency_model_settlement_items')
      .insert({
        settlement_id: settlementId,
        description: item.description,
        quantity: item.quantity,
        unit_amount_cents: item.unit_amount_cents,
        total_amount_cents: total,
        currency: item.currency ?? 'EUR',
        position: item.position ?? 0,
        metadata: item.metadata ?? {},
      })
      .select('id')
      .single();
    if (error) {
      console.error('[addAgencyModelSettlementItem] error:', error);
      return null;
    }
    const id = (data?.id as string) ?? null;
    if (id) await recomputeSettlementTotals(settlementId);
    return id;
  } catch (e) {
    console.error('[addAgencyModelSettlementItem] exception:', e);
    return null;
  }
}

export async function deleteAgencyModelSettlementItem(
  itemId: string,
  settlementId: string,
): Promise<boolean> {
  if (!itemId || !settlementId) return false;
  try {
    const { error } = await supabase
      .from('agency_model_settlement_items')
      .delete()
      .eq('id', itemId)
      .eq('settlement_id', settlementId);
    if (error) {
      console.error('[deleteAgencyModelSettlementItem] error:', error);
      return false;
    }
    await recomputeSettlementTotals(settlementId);
    return true;
  } catch (e) {
    console.error('[deleteAgencyModelSettlementItem] exception:', e);
    return false;
  }
}

/**
 * Recompute gross/net totals on the parent settlement from its items.
 * Best-effort; only writes while status === 'draft'.
 *
 * Convention:
 * - gross_amount_cents = sum of all item totals (what model earned before commission)
 * - commission_amount_cents stays as set by the agency (independent agency revenue)
 * - net_amount_cents = gross - commission (what model is owed)
 *
 * If commission_amount_cents has not been set, we leave it untouched and
 * only refresh gross + recompute net from existing commission.
 */
export async function recomputeSettlementTotals(settlementId: string): Promise<boolean> {
  if (!settlementId) return false;
  try {
    const { data: settlement } = await supabase
      .from('agency_model_settlements')
      .select('id, status, commission_amount_cents')
      .eq('id', settlementId)
      .maybeSingle();
    if (!settlement || settlement.status !== 'draft') return true;
    const { data: items } = await supabase
      .from('agency_model_settlement_items')
      .select('total_amount_cents')
      .eq('settlement_id', settlementId);
    const gross = (items ?? []).reduce(
      (acc: number, r: { total_amount_cents: number | null }) =>
        acc + Number(r.total_amount_cents ?? 0),
      0,
    );
    const commission = Number(settlement.commission_amount_cents ?? 0);
    const net = gross - commission;
    const { error } = await supabase
      .from('agency_model_settlements')
      .update({
        gross_amount_cents: gross,
        net_amount_cents: net,
      })
      .eq('id', settlementId)
      .eq('status', 'draft');
    if (error) {
      console.error('[recomputeSettlementTotals] error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[recomputeSettlementTotals] exception:', e);
    return false;
  }
}
