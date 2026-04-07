/**
 * Standard service-layer result for Account / Org / GDPR flows (and extensions).
 * Prefer over bare booleans so callers always branch on `if (!res.ok)`.
 *
 * Note: `gdprComplianceSupabase` still uses `ComplianceResult` with `reason` on failure
 * for historical call sites; new code in this package should use `ServiceResult`.
 */
export type ServiceResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

export function serviceOk(): ServiceResult {
  return { ok: true };
}

export function serviceOkData<T>(data: T): ServiceResult<T> {
  return { ok: true, data } as ServiceResult<T>;
}

export function serviceErr(error: string): ServiceResult<never> {
  return { ok: false, error };
}
