import {
  attentionSignalsFromOptionRequestLike,
  deriveNegotiationAttention,
  priceCommerciallySettledForUi,
  type AttentionSignalInput,
} from './optionRequestAttention';
import { isPriceNegotiationRequest } from './priceNegotiationRequest';

export type AgencyPriceActionInput = {
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

function buildSignals(input: AgencyPriceActionInput): AttentionSignalInput {
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
 * Agency may show Axis-1 (price) controls when D1 requires agency action or re-counter.
 * Independent of status === 'in_negotiation' — model approval can set status='confirmed'
 * while price negotiation continues (same asymmetry as client accept counter).
 */
export function shouldShowAgencyPriceNegotiationActions(input: AgencyPriceActionInput): boolean {
  if (!input.isAgency) return false;
  if (input.isAgencyOnly === true) return false;
  if (!isPriceNegotiationRequest(input.requestType ?? null)) return false;

  const isTerminal = input.finalStatus === 'job_confirmed' || input.status === 'rejected';
  if (isTerminal) return false;

  const signals = buildSignals(input);
  if (priceCommerciallySettledForUi(signals)) return false;

  const d1 = deriveNegotiationAttention(signals);
  return (
    d1 === 'counter_rejected' || d1 === 'waiting_for_agency_response' || d1 === 'negotiation_open'
  );
}

/** Client must respond to an existing counter — agency cannot send another yet. */
export function isAgencyAwaitingClientOnCounter(input: AgencyPriceActionInput): boolean {
  if (!input.isAgency || input.isAgencyOnly === true) return false;
  if (input.finalStatus === 'job_confirmed' || input.status === 'rejected') return false;

  const signals = buildSignals(input);
  if (priceCommerciallySettledForUi(signals)) return false;

  return (
    deriveNegotiationAttention(signals) === 'waiting_for_client_response' &&
    input.agencyCounterPrice != null &&
    !Number.isNaN(Number(input.agencyCounterPrice)) &&
    input.clientPriceStatus === 'pending' &&
    input.finalStatus !== 'job_confirmed'
  );
}

/** Accept / decline client's proposed fee (no agency counter sent yet). */
export function shouldShowAgencyAcceptDeclineProposedFee(input: AgencyPriceActionInput): boolean {
  if (!shouldShowAgencyPriceNegotiationActions(input)) return false;
  if (isAgencyAwaitingClientOnCounter(input)) return false;

  const signals = buildSignals(input);
  if (deriveNegotiationAttention(signals) !== 'waiting_for_agency_response') return false;
  if (input.proposedPrice == null || Number.isNaN(Number(input.proposedPrice))) return false;
  if (input.agencyCounterPrice != null) return false;
  return input.clientPriceStatus === 'pending';
}

/** Inline counter-offer input (first counter or after client declined). */
export function shouldShowAgencySendCounterOffer(input: AgencyPriceActionInput): boolean {
  if (!shouldShowAgencyPriceNegotiationActions(input)) return false;
  if (isAgencyAwaitingClientOnCounter(input)) return false;

  const signals = buildSignals(input);
  const d1 = deriveNegotiationAttention(signals);

  if (d1 === 'counter_rejected') return true;

  if (d1 === 'waiting_for_agency_response' || d1 === 'negotiation_open') {
    if (input.clientPriceStatus !== 'pending') return false;
    if (input.agencyCounterPrice != null) return false;
    if (d1 === 'waiting_for_agency_response' && input.proposedPrice != null) return true;
    if (d1 === 'negotiation_open' && input.proposedPrice == null) return true;
  }

  return false;
}

/** Propose initial fee when client sent no proposed price. */
export function shouldShowAgencyProposeInitialFee(input: AgencyPriceActionInput): boolean {
  if (!shouldShowAgencyPriceNegotiationActions(input)) return false;
  if (isAgencyAwaitingClientOnCounter(input)) return false;

  const signals = buildSignals(input);
  return (
    deriveNegotiationAttention(signals) === 'negotiation_open' &&
    input.clientPriceStatus === 'pending' &&
    (input.proposedPrice == null || Number.isNaN(Number(input.proposedPrice)))
  );
}
