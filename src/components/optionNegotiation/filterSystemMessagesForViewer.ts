import { uiCopy } from '../../constants/uiCopy';
import type { ChatMessage } from '../../store/optionRequests';

export type OptionNegotiationViewerRole = 'agency' | 'client';

/**
 * Hides agency-only or client-only system lines for the wrong viewer (same text stored in DB).
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
  return true;
}
