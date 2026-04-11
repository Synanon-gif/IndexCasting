import { uiCopy } from '../../constants/uiCopy';
import type { ChatMessage } from '../../store/optionRequests';

export type OptionNegotiationViewerRole = 'agency' | 'client' | 'model';

const PRICE_SYSTEM_MESSAGE_PREFIXES: string[] = [
  uiCopy.systemMessages.agencyAcceptedPrice.trim(),
  uiCopy.systemMessages.agencyDeclinedPrice.trim(),
  uiCopy.systemMessages.clientAcceptedCounter.trim(),
  uiCopy.systemMessages.clientRejectedCounter.trim(),
  uiCopy.systemMessages.jobConfirmedByClient.trim(),
];

const AGENCY_COUNTER_PREFIX = 'Agency proposed ';

/**
 * Hides system lines that the viewer should not see.
 * - agency/client: filters no-model-account lines for the wrong role
 * - model: hides ALL price-related system messages (commercial data)
 */
export function shouldShowSystemMessageForViewer(
  msg: ChatMessage,
  viewer: OptionNegotiationViewerRole,
): boolean {
  if (msg.from !== 'system') return true;
  const t = msg.text.trim();

  const agencyLine = uiCopy.systemMessages.noModelAccount.trim();
  const clientLine = uiCopy.systemMessages.noModelAccountClientNotice.trim();
  if (t === agencyLine) return viewer === 'agency';
  if (t === clientLine) return viewer === 'client';

  if (viewer === 'model') {
    if (PRICE_SYSTEM_MESSAGE_PREFIXES.some((p) => t === p)) return false;
    if (t.startsWith(AGENCY_COUNTER_PREFIX)) return false;
    if (t === agencyLine || t === clientLine) return false;
  }

  return true;
}
