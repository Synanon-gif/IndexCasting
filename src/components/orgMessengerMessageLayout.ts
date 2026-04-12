import type { TextStyle, ViewStyle } from 'react-native';
import { spacing } from '../theme/theme';

/** Horizontal gutter for outgoing B2B message blocks (matches previous bubble-only offset). */
const OUTGOING_GUTTER_LEFT = '12%';

/**
 * Column wrapper for one message: aligns sender label + attachments + bubbles + cards together.
 */
export function getOrgMessengerMessageColumnStyle(isOwn: boolean): ViewStyle {
  return {
    width: '100%',
    alignItems: isOwn ? 'flex-end' : 'flex-start',
    ...(isOwn
      ? { paddingLeft: OUTGOING_GUTTER_LEFT, paddingRight: spacing.sm }
      : {}),
  };
}

/** Subtle alignment for sender name above outgoing bubbles (multi-line safe). */
export function getOrgMessengerSenderLineExtraStyle(isOwn: boolean): TextStyle {
  if (!isOwn) return {};
  return { textAlign: 'right', alignSelf: 'stretch' };
}

export const orgMessengerLayoutTestExports = {
  OUTGOING_GUTTER_LEFT,
};
