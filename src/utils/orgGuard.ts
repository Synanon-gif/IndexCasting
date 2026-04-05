/**
 * Runtime guard for org/agency context.
 *
 * Usage in services:
 *   if (!assertOrgContext(agencyId, 'confirmOption')) return;
 *   // here agencyId is guaranteed to be a non-empty string
 *
 * Replaces the silent `?? ''` pattern that writes empty org_id into audit logs
 * and lets queries run without a proper org filter.
 */

/**
 * Returns true when orgId is a non-empty string, false otherwise.
 * On failure: logs a structured error so the call site can be found quickly.
 *
 * @param orgId   - The org_id / agency_id to validate.
 * @param caller  - Name of the calling function (for log context).
 */
export function assertOrgContext(
  orgId: string | null | undefined,
  caller: string,
): orgId is string {
  if (!orgId || orgId.trim() === '') {
    console.error(
      `[assertOrgContext] org context missing — call aborted`,
      { caller, received: orgId },
    );
    return false;
  }
  return true;
}
