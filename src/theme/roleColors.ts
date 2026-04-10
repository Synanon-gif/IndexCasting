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

/**
 * Self = same side as viewer role (WhatsApp-style alignment only).
 */
export function isSelfMessage(
  from: ChatParticipantRole,
  viewerRole: 'agency' | 'client',
): boolean {
  if (from === 'system') return false;
  if (viewerRole === 'agency') return from === 'agency';
  return from === 'client';
}
