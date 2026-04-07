/**
 * Option C (hybrid): **new or refactored** service exports may return `ServiceResult`
 * so callers branch with `if (!res.ok)`. Existing exports keep **Option A** (`boolean` /
 * `null` / `[]`) — do not mix return shapes inside one function.
 *
 * Optional wrappers: `myActionSafe()` calls `myAction()` (Option A) and maps to
 * `ServiceResult` without changing legacy call sites.
 *
 * Legacy: `gdprComplianceSupabase` may use `ComplianceResult` where documented.
 *
 * **StructuredServiceResult** — optional parallel shape for **new** APIs that need
 * machine-readable `code` + optional `context`. Do not migrate existing `ServiceResult`
 * call sites; use one shape per function.
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

/** Machine-readable failure detail for new APIs (parallel to string-only `ServiceResult`). */
export type ServiceErrorDetail = {
  code: string;
  message: string;
  context?: unknown;
};

export type StructuredServiceResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: ServiceErrorDetail };

export function structuredServiceOk(): StructuredServiceResult {
  return { ok: true };
}

export function structuredServiceOkData<T>(data: T): StructuredServiceResult<T> {
  return { ok: true, data } as StructuredServiceResult<T>;
}

export function structuredServiceErr(
  code: string,
  message: string,
  context?: unknown,
): StructuredServiceResult<never> {
  return { ok: false, error: context !== undefined ? { code, message, context } : { code, message } };
}

/**
 * Adapts a string-based {@link ServiceResult} to {@link StructuredServiceResult} for new code paths
 * that need `error.code` without changing the underlying Option-C function.
 */
export function serviceResultToStructured<T>(
  r: ServiceResult<T>,
  errorCode = 'service_error',
): StructuredServiceResult<T> {
  if (!r.ok) {
    return structuredServiceErr(errorCode, r.error);
  }
  if ('data' in r) {
    return structuredServiceOkData((r as { ok: true; data: T }).data);
  }
  return structuredServiceOk() as StructuredServiceResult<T>;
}
