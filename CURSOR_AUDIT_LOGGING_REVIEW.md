# Audit logging review — IndexCasting

## Method

- Searched `src/services/**/*.ts` and `src/utils/logAction.ts` for:
  - Direct `logBookingAction`, `logOptionAction`, `logImageUpload` outside the GDPR module
  - Patterns that bypass `logAction()` / `assertOrgContext`
- Confirmed [src/utils/logAction.ts](src/utils/logAction.ts) remains the intended wrapper (`source` defaults to `api`).

## Findings

### Compliant / centralized

- **Direct legacy wrappers:** `logBookingAction`, `logOptionAction`, `logImageUpload` appear only in [src/services/gdprComplianceSupabase.ts](src/services/gdprComplianceSupabase.ts) (implementation), [src/utils/logAction.ts](src/utils/logAction.ts) (delegation), and tests — **no stray direct calls** in other services.
- **`logAuditAction`:** Used inside `gdprComplianceSupabase.ts` (RPC `log_audit_action`) and from `logAction.ts`; internal GDPR flows use `logAuditAction` with documented patterns — **acceptable** per project rules.
- **`logAction` usage:** Present on critical paths in e.g. `optionRequestsSupabase.ts`, `bookingsSupabase.ts`, `bookingEventsSupabase.ts`, `modelPhotosSupabase.ts`, `organizationsInvitationsSupabase.ts`.

### Documented gaps (no code change this wave)

- **No `logAction` imports:** Services such as `projectsSupabase.ts`, `applicationsSupabase.ts`, `recruitingChatSupabase.ts` do not call `logAction`. They may rely on RLS-only persistence, separate `log_activity` ([activityLogsSupabase.ts](src/services/activityLogsSupabase.ts)), or product choice. **Treating as future wave / product decision** — not a safe minimal fix without scope creep.
- **Explicit `source: 'rpc' | 'system'`:** Few call sites pass non-default `source`; most frontend paths correctly use default `api`. Admin/server-initiated flows can be marked in a later pass where unambiguous.

## What was corrected in code

- **None** — review found no small, unambiguous violation that required a one-line fix outside the agreed boundaries.

## Why changes would stay small if added later

- Prefer `logAction(orgId, 'caller', { type, action, ... }, { source: 'rpc' })` over raw `logAuditAction` for new call sites.
- Use `allowEmptyOrg: true` only for GDPR-internal flows already documented in `logAction.ts`.

## Conclusion

Audit trail centralization is **largely consistent** with project rules; remaining gaps are **documented**, not silently “fixed” with broad instrumentation.
