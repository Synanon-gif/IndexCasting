import { uiCopy } from '../constants/uiCopy';

/**
 * Primary line for B2B org chat when the viewer is a client: "Model — Agency" when a model
 * can be inferred from thread messages; otherwise agency (counterparty) name or generic fallback.
 * No network calls — model name is supplied by the caller (e.g. resolved from booking messages).
 */
export function formatB2bClientHeaderPrimary(
  counterpartyAgencyName: string,
  modelName: string | null | undefined,
): string {
  const generic = uiCopy.b2bChat.conversationFallback;
  const raw = counterpartyAgencyName.trim();
  const isGeneric = raw === '' || raw === generic;
  const m = modelName?.trim() ?? '';
  if (m && !isGeneric) return `${m} — ${raw}`;
  if (m && isGeneric) return m;
  if (!isGeneric) return raw;
  return generic;
}
