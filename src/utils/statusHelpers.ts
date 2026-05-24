/**
 * Status display helpers.
 *
 * Maps the internal DB status fields of option_requests to unified,
 * user-facing display labels. The DB status values remain unchanged —
 * only the UI presentation is standardized.
 */

import { colors } from '../theme/theme';
import { priceCommerciallySettled } from './priceSettlement';

export type DisplayStatus =
  | 'Draft'
  | 'Pending'
  | 'In negotiation'
  | 'Price agreed'
  | 'Option confirmed'
  | 'Casting confirmed'
  | 'Confirmed'
  | 'Rejected';

/** Optional price fields — same commercial-settlement gate as `priceCommerciallySettledForUi` (optionRequestAttention). */
export type OptionPriceDisplaySignals = {
  clientPriceStatus?: 'pending' | 'accepted' | 'rejected' | null;
  agencyCounterPrice?: number | null;
  proposedPrice?: number | null;
  requestType?: string | null;
};

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
  const isCasting = priceSignals?.requestType === 'casting';
  if (finalStatus === 'job_confirmed') return 'Confirmed';
  if (status === 'confirmed' && finalStatus === 'option_confirmed') return 'Confirmed';
  if (finalStatus === 'option_confirmed') {
    return isCasting ? 'Casting confirmed' : 'Option confirmed';
  }
  if (status === 'confirmed') return 'Confirmed';
  if (status === 'rejected') return 'Rejected';
  if (status === 'in_negotiation') {
    if (isCasting) return 'Pending';
    if (
      priceSignals &&
      priceCommerciallySettled({
        clientPriceStatus: priceSignals.clientPriceStatus ?? null,
        agencyCounterPrice: priceSignals.agencyCounterPrice ?? null,
        proposedPrice: priceSignals.proposedPrice ?? null,
      }) &&
      finalStatus !== 'option_confirmed' &&
      finalStatus !== 'job_confirmed'
    ) {
      return 'Price agreed';
    }
    return 'In negotiation';
  }
  return 'Draft';
}

/** Smart-attention pills in option-request thread lists (shared across agency + client). */
export const attentionBadgeColors = {
  text: colors.accentBrown,
  background: colors.surfaceWarm,
  border: colors.borderLight,
} as const;

/** Model-approval pills in option-request thread lists. */
export const modelApprovalBadgeColors = {
  noAccount: {
    text: colors.textSecondary,
    background: colors.surfaceAlt,
    border: colors.border,
  },
  approved: {
    text: colors.buttonOptionGreen,
    background: '#E8EEEB',
    border: colors.buttonOptionGreen,
  },
  rejected: {
    text: colors.buttonSkipRed,
    background: '#F0E8E8',
    border: colors.buttonSkipRed,
  },
  pending: {
    text: colors.warning,
    background: colors.surfaceWarm,
    border: colors.warning,
  },
} as const;

/** Returns a color token for a given display status (muted, high-contrast, theme-aligned). */
export function statusColor(displayStatus: DisplayStatus): string {
  switch (displayStatus) {
    case 'Confirmed':
      return colors.buttonOptionGreen;
    case 'Option confirmed':
    case 'Casting confirmed':
      return colors.accentGreen;
    case 'Rejected':
      return colors.buttonSkipRed;
    case 'In negotiation':
      return '#6B4E1A';
    case 'Price agreed':
      return colors.accentBrown;
    case 'Pending':
    case 'Draft':
    default:
      return colors.textSecondary;
  }
}

/** Returns the background color token for a status badge. */
export function statusBgColor(displayStatus: DisplayStatus): string {
  switch (displayStatus) {
    case 'Confirmed':
      return '#E8EEEB';
    case 'Option confirmed':
    case 'Casting confirmed':
      return '#E6EDEA';
    case 'Rejected':
      return '#F0E8E8';
    case 'In negotiation':
      return colors.surfaceWarm;
    case 'Price agreed':
      return colors.surfaceAlt;
    case 'Pending':
    case 'Draft':
    default:
      return colors.surfaceAlt;
  }
}
