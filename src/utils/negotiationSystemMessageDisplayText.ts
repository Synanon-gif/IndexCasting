import { uiCopy } from '../constants/uiCopy';

/** Rewrites persisted option-only system lines for casting threads (DB text stays option-shaped). */
export function negotiationSystemMessageDisplayText(
  text: string,
  requestType: string | null | undefined,
): string {
  if (requestType !== 'casting') return text;
  const trimmed = text.trim();
  if (trimmed === uiCopy.systemMessages.agencyConfirmedAvailability.trim()) {
    return uiCopy.systemMessages.agencyConfirmedAvailabilityCasting;
  }
  if (trimmed === uiCopy.systemMessages.noModelAccount.trim()) {
    return uiCopy.systemMessages.noModelAccountCasting;
  }
  return text;
}
