/**
 * Quick reply template strings for the messenger.
 * Constants-based — no DB round-trip needed for core templates.
 */

export const QUICK_REPLIES = [
  'Need polaroids',
  'Confirming date',
  'Will follow up shortly',
  'Please send updated measurements',
  'Available for this date',
  'Not available — please suggest alternatives',
] as const;

export type QuickReply = (typeof QUICK_REPLIES)[number];
