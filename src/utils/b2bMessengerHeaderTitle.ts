import { uiCopy } from '../constants/uiCopy';

/**
 * Primary line for the B2B org chat header when the viewer is a client.
 *
 * RULE: A B2B org-chat conversation is between two ORGANIZATIONS (client org ↔ agency
 * org). The header MUST identify the COUNTERPARTY ORGANIZATION ONLY — never a model
 * name, even when bookings of specific models exist in the thread. Models live in
 * the option-request chats (where prefixing the model is meaningful for both sides);
 * leaking a model name into the org chat header confuses identity and is a privacy /
 * UX regression. The same constraint applies to the agency-side header (which already
 * shows only the client-org name).
 *
 * The `modelName` parameter is intentionally accepted but ignored — kept in the
 * signature so callers (e.g. OrgMessengerInline) can keep their existing wiring
 * without breaking and so a future explicit per-thread "model context" UI element
 * can be re-introduced separately from the title.
 */
export function formatB2bClientHeaderPrimary(
  counterpartyAgencyName: string,
  _modelName?: string | null,
): string {
  void _modelName;
  const generic = uiCopy.b2bChat.conversationFallback;
  const raw = counterpartyAgencyName.trim();
  if (raw === '' || raw === generic) return generic;
  return raw;
}
