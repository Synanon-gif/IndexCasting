/**
 * Price negotiation applies only to option requests — never castings.
 * Castings use availability / model-approval flows only (Axis 2).
 */

export type OptionRequestKind = 'option' | 'casting';

/** True when Axis 1 (price / counter-offer) is a valid product axis for this request type. */
export function isPriceNegotiationRequest(
  requestType: string | null | undefined,
): requestType is 'option' {
  return requestType !== 'casting';
}

/** UI gate: show price CTAs, badges, and commercial settlement prompts. */
export function shouldShowPriceNegotiationControls(input: {
  requestType?: string | null;
  isAgencyOnly?: boolean | null;
}): boolean {
  if (input.isAgencyOnly === true) return false;
  return isPriceNegotiationRequest(input.requestType ?? null);
}
