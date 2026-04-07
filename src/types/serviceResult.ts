/**
 * Option C (hybrid): **new or refactored** service exports may return `ServiceResult`
 * so callers branch with `if (!res.ok)`. Existing exports keep **Option A** (`boolean` /
 * `null` / `[]`) — do not mix return shapes inside one function.
 *
 * Optional wrappers: `myActionSafe()` calls `myAction()` (Option A) and maps to
 * `ServiceResult` without changing legacy call sites.
 *
 * Legacy: `gdprComplianceSupabase` may use `ComplianceResult` where documented.
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
