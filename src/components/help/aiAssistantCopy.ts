import { uiCopy } from '../../constants/uiCopy';

export type AiAssistantViewerRole = 'agency' | 'client' | 'model';

const LIVE_DATA_PATTERNS = [
  /\b(which|what|show|list|give me|tell me)\b.*\b(bookings?|options?|castings?|requests?|invoices?|messages?|models?|organization|team|members?)\b/i,
  /\b(status)\b.*\b(my|our|this)\b.*\b(request|option|casting|booking|invoice)\b/i,
  /\b(available|availability)\b.*\b(today|tomorrow|this week|next week|now)\b/i,
  /\b(who)\b.*\b(organization|team|company|agency|client)\b/i,
  /\b(what did|what has)\b.*\b(client|agency|model|booker|employee)\b.*\b(say|write|send)\b/i,
];

export function getAiAssistantSubtitle(role: AiAssistantViewerRole): string {
  return uiCopy.aiAssistant.subtitles[role];
}

export function isAiAssistantLiveDataQuestion(input: string): boolean {
  const normalized = input.trim();
  if (!normalized) return false;
  return LIVE_DATA_PATTERNS.some((pattern) => pattern.test(normalized));
}
