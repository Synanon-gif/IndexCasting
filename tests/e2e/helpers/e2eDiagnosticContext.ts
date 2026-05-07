import type { E2EWriteKind } from './env';

/**
 * Optional per-test metadata for failure-summary.md (no secrets).
 * Reset automatically in `fixtures/base.ts` before each test.
 */
export type E2EDiagnosticContext = {
  /** e.g. agencyOwner+clientOwner */
  roleKey?: string;
  /** Domain slice only, e.g. index-casting.test — never full email */
  emailDomainHint?: string;
  /** Main risk driver for writeGate line */
  writeKind?: E2EWriteKind | 'read' | 'none';
};

let ctx: E2EDiagnosticContext = {};

export function setE2eDiagnosticContext(patch: E2EDiagnosticContext): void {
  ctx = { ...ctx, ...patch };
}

export function resetE2eDiagnosticContext(): void {
  ctx = {};
}

export function getE2eDiagnosticContext(): E2EDiagnosticContext {
  return { ...ctx };
}
