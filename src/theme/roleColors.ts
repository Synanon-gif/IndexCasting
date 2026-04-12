import { colors } from './theme';

/**
 * Canonical role colors for chat bubbles, badges, chips — single mapping (no ad-hoc hex in views).
 */
export const roleMessageColors = {
  client: {
    bubbleBackground: '#E8E6E1',
    bubbleText: colors.textPrimary,
    borderColor: colors.border,
  },
  agency: {
    bubbleBackground: '#F3EDE4',
    bubbleText: colors.accentBrown,
    borderColor: '#C4B8A8',
  },
  model: {
    bubbleBackground: '#E8EEF5',
    bubbleText: '#1E3A5F',
    borderColor: '#B8C5D9',
  },
} as const;

export type ChatParticipantRole = 'client' | 'agency' | 'model' | 'system';

export function bubbleColorsForSender(from: ChatParticipantRole): {
  bubbleBackground: string;
  bubbleText: string;
  borderColor: string;
} {
  if (from === 'system') {
    return {
      bubbleBackground: 'rgba(120,120,120,0.08)',
      bubbleText: colors.textSecondary,
      borderColor: colors.border,
    };
  }
  return roleMessageColors[from];
}

/** Unified outgoing bubble (current user) — soft green, dark text, all roles. */
export const outgoingSelfBubbleColors = {
  bubbleBackground: '#E6F2EC',
  bubbleText: colors.textPrimary,
  borderColor: '#C5D9CE',
} as const;

export type NegotiationViewerRole = 'agency' | 'client' | 'model';

/**
 * Bubble colors for option/casting rows: outgoing (viewer's side) vs incoming (counterpart).
 */
export function negotiationBubbleAppearance(
  from: ChatParticipantRole,
  viewerRole: NegotiationViewerRole,
): {
  bubbleBackground: string;
  bubbleText: string;
  borderColor: string;
} {
  if (isSelfMessage(from, viewerRole)) {
    return {
      bubbleBackground: outgoingSelfBubbleColors.bubbleBackground,
      bubbleText: outgoingSelfBubbleColors.bubbleText,
      borderColor: outgoingSelfBubbleColors.borderColor,
    };
  }
  return bubbleColorsForSender(from);
}

/**
 * Self = same side as viewer role (alignment / outgoing styling).
 */
export function isSelfMessage(
  from: ChatParticipantRole,
  viewerRole: NegotiationViewerRole,
): boolean {
  if (from === 'system') return false;
  if (viewerRole === 'agency') return from === 'agency';
  if (viewerRole === 'model') return from === 'model';
  return from === 'client';
}
