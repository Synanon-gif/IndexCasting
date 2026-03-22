/**
 * Agency Recruiting → "My list" = explicit shortlist ∪ pending applications that already have a recruiting thread
 * (same population as Messages → Recruiting chats before acceptance).
 */
export function mergeAgencyRecruitingMyListIds(
  shortlistIds: string[],
  pendingApplicationIdsWithChat: string[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of shortlistIds) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of pendingApplicationIdsWithChat) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
