/** Stable id for deduplicating client↔agency org pair chats (shared with Supabase `conversations.context_id`). */
export function b2bOrgPairContextId(clientOrgId: string, agencyOrgId: string): string {
  const [a, b] = [clientOrgId, agencyOrgId].sort((x, y) => x.localeCompare(y));
  return `b2b:${a}:${b}`;
}
