/**
 * Centralized commercial-settlement check.
 * Shared by optionRequestAttention.ts and statusHelpers.ts — lives here to avoid circular imports.
 */

export type PriceSettlementInput = {
  clientPriceStatus?: 'pending' | 'accepted' | 'rejected' | null;
  agencyCounterPrice?: number | null;
  proposedPrice?: number | null;
};

/**
 * Price accepted in DB plus at least one commercial anchor — use to lock counter/reject UI.
 * Stricter than RPC `client_confirm_option_job` (which only checks `client_price_status`).
 */
export function priceCommerciallySettled(input: PriceSettlementInput): boolean {
  if (input.clientPriceStatus !== 'accepted') return false;
  const hasAgency =
    input.agencyCounterPrice != null && !Number.isNaN(Number(input.agencyCounterPrice));
  const hasProposed = input.proposedPrice != null && !Number.isNaN(Number(input.proposedPrice));
  return hasAgency || hasProposed;
}
