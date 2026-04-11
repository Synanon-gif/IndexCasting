/**
 * Status display helpers.
 *
 * Maps the internal DB status fields of option_requests to unified,
 * user-facing display labels. The DB status values remain unchanged —
 * only the UI presentation is standardized.
 */

export type DisplayStatus =
  | 'Draft'
  | 'In negotiation'
  | 'Price agreed'
  | 'Confirmed'
  | 'Rejected';

/** Optional price fields — same commercial-settlement gate as `priceCommerciallySettledForUi` (optionRequestAttention). */
export type OptionPriceDisplaySignals = {
  clientPriceStatus?: 'pending' | 'accepted' | 'rejected' | null;
  agencyCounterPrice?: number | null;
  proposedPrice?: number | null;
};

function isPriceCommerciallySettledForDisplay(s: OptionPriceDisplaySignals | null | undefined): boolean {
  if (!s || s.clientPriceStatus !== 'accepted') return false;
  const hasAgency =
    s.agencyCounterPrice != null && !Number.isNaN(Number(s.agencyCounterPrice));
  const hasProposed = s.proposedPrice != null && !Number.isNaN(Number(s.proposedPrice));
  return hasAgency || hasProposed;
}

/**
 * Converts the internal option_request status + final_status to a single
 * clean display label following the draft → sent → confirmed flow.
 * Pass `priceSignals` so that after commercial price settlement the UI does not
 * still read "In negotiation" while negotiation attention is `price_agreed`.
 */
export function toDisplayStatus(
  status: string | null,
  finalStatus: string | null,
  priceSignals?: OptionPriceDisplaySignals | null,
): DisplayStatus {
  if (finalStatus === 'job_confirmed') return 'Confirmed';
  if (status === 'confirmed' || finalStatus === 'option_confirmed') return 'Confirmed';
  if (status === 'rejected') return 'Rejected';
  if (status === 'in_negotiation') {
    if (
      priceSignals &&
      isPriceCommerciallySettledForDisplay(priceSignals) &&
      finalStatus !== 'option_confirmed' &&
      finalStatus !== 'job_confirmed'
    ) {
      return 'Price agreed';
    }
    return 'In negotiation';
  }
  return 'Draft';
}

/** Returns a color token for a given display status (Tailwind / RN compatible). */
export function statusColor(displayStatus: DisplayStatus): string {
  switch (displayStatus) {
    case 'Confirmed': return '#16a34a'; // green-600
    case 'Rejected':  return '#dc2626'; // red-600
    case 'In negotiation': return '#d97706'; // amber-600
    case 'Price agreed': return '#2563eb'; // blue-600
    case 'Draft':
    default:          return '#6b7280'; // gray-500
  }
}

/** Returns the background color token for a status badge. */
export function statusBgColor(displayStatus: DisplayStatus): string {
  switch (displayStatus) {
    case 'Confirmed': return '#dcfce7'; // green-100
    case 'Rejected':  return '#fee2e2'; // red-100
    case 'In negotiation': return '#fef3c7'; // amber-100
    case 'Price agreed': return '#dbeafe'; // blue-100
    case 'Draft':
    default:          return '#f3f4f6'; // gray-100
  }
}
