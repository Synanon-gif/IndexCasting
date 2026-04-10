/**
 * Single source of truth for negotiated fee display and downstream checks.
 * Commercial amount lives on option_requests — no parallel calendar fee column.
 */

export type CanonicalOptionPriceFields = {
  proposed_price?: number | null;
  agency_counter_price?: number | null;
  client_price_status?: string | null;
  final_status?: string | null;
};

/**
 * After the deal is closed (option or job confirmed) and price is accepted:
 * agreed amount = counter when set (client accepted agency counter), else client's proposed amount.
 */
export function getCanonicalAgreedPrice(f: CanonicalOptionPriceFields): number | null {
  if (f.client_price_status !== 'accepted') return null;
  const fs = f.final_status ?? null;
  if (fs !== 'option_confirmed' && fs !== 'job_confirmed') return null;
  const c = f.agency_counter_price;
  const p = f.proposed_price;
  if (c != null && Number.isFinite(c)) return c;
  if (p != null && Number.isFinite(p)) return p;
  return null;
}

/**
 * During active negotiation: which single amount best represents the "live" offer for display hints.
 * Agency counter overwrites previous proposed for display when present.
 */
export function getNegotiationDisplayPriceCandidate(f: CanonicalOptionPriceFields): number | null {
  const c = f.agency_counter_price;
  const p = f.proposed_price;
  if (c != null && Number.isFinite(c)) return c;
  if (p != null && Number.isFinite(p)) return p;
  return null;
}
