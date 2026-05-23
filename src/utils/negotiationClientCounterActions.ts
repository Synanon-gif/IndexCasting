import {
  attentionSignalsFromOptionRequestLike,
  deriveNegotiationAttention,
  priceCommerciallySettledForUi,
  type AttentionSignalInput,
} from './optionRequestAttention';
import { isPriceNegotiationRequest } from './priceNegotiationRequest';

export type ShouldShowClientAcceptCounterInput = {
  isAgency: boolean;
  status: string | null | undefined;
  finalStatus?: string | null;
  clientPriceStatus?: 'pending' | 'accepted' | 'rejected' | null;
  agencyCounterPrice?: number | null;
  proposedPrice?: number | null;
  modelApproval?: 'pending' | 'approved' | 'rejected' | null;
  modelAccountLinked?: boolean | null;
  isAgencyOnly?: boolean;
  requestType?: string | null;
};

export function buildAttentionSignalsFromClientCounterInput(
  input: ShouldShowClientAcceptCounterInput,
): AttentionSignalInput {
  return attentionSignalsFromOptionRequestLike({
    status: input.status ?? '',
    finalStatus: input.finalStatus ?? null,
    clientPriceStatus: input.clientPriceStatus ?? null,
    modelApproval: input.modelApproval,
    modelAccountLinked: input.modelAccountLinked,
    agencyCounterPrice: input.agencyCounterPrice ?? null,
    proposedPrice: input.proposedPrice ?? null,
    isAgencyOnly: input.isAgencyOnly ?? false,
    requestType: input.requestType ?? null,
  });
}

/**
 * Client may accept an agency counter when Axis 1 (price) requires client action.
 * Independent of status === 'in_negotiation' — model approval can flip status to
 * 'confirmed' while client_price_status stays pending (backend RPC allows accept).
 */
export function shouldShowClientAcceptCounterAction(
  input: ShouldShowClientAcceptCounterInput,
): boolean {
  if (input.isAgency) return false;
  if (input.isAgencyOnly === true) return false;
  if (!isPriceNegotiationRequest(input.requestType ?? null)) return false;

  const isTerminal = input.finalStatus === 'job_confirmed' || input.status === 'rejected';
  if (isTerminal) return false;

  const signals = buildAttentionSignalsFromClientCounterInput(input);
  if (priceCommerciallySettledForUi(signals)) return false;
  if (deriveNegotiationAttention(signals) !== 'waiting_for_client_response') {
    return false;
  }
  if (input.agencyCounterPrice == null || Number.isNaN(Number(input.agencyCounterPrice))) {
    return false;
  }
  if (input.clientPriceStatus !== 'pending') return false;

  return true;
}

/** @deprecated Use {@link shouldShowAgencyPriceNegotiationActions} — price Axis-1 stays open on status=confirmed. */
export function isAgencyPriceNegotiationOpen(status: string | null | undefined): boolean {
  return status === 'in_negotiation' || status === 'confirmed';
}
