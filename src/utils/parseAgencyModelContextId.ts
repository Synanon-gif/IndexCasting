/** Canonical `conversations.context_id` for agency↔model direct threads. */
export function agencyModelDirectContextId(agencyId: string, modelId: string): string {
  return `agency-model:${agencyId.trim()}:${modelId.trim()}`;
}

/** Parse `conversations.context_id` for agency↔model direct threads (`agency-model:{agencyUuid}:{modelUuid}`). */
export function parseAgencyModelContextId(
  contextId: string | null | undefined,
): { agencyId: string; modelId: string } | null {
  if (!contextId || typeof contextId !== 'string') return null;
  const prefix = 'agency-model:';
  if (!contextId.startsWith(prefix)) return null;
  const rest = contextId.slice(prefix.length);
  const idx = rest.indexOf(':');
  if (idx <= 0 || idx >= rest.length - 1) return null;
  const agencyId = rest.slice(0, idx).trim();
  const modelId = rest.slice(idx + 1).trim();
  if (!agencyId || !modelId) return null;
  return { agencyId, modelId };
}
