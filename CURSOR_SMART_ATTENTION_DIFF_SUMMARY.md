# Smart Attention Diff Summary

## Changed files

- `src/utils/optionRequestAttention.ts`
- `src/constants/uiCopy.ts`
- `src/views/AgencyControllerView.tsx`
- `src/web/ClientWebApp.tsx`
- `src/views/ModelView.tsx`
- `src/utils/__tests__/optionRequestAttention.test.ts`
- `src/utils/__tests__/statusHelpers.test.ts`
- `src/services/__tests__/clientAssignmentsSupabase.test.ts`
- `docs/SMART_ATTENTION_SYSTEM.md`
- `docs/CLIENT_ASSIGNMENT_FLAG_SYSTEM.md`
- `.cursorrules`
- `.cursor/rules/system-invariants.mdc`
- `.cursor/rules/auto-review.mdc`

## Purpose

- Added a canonical smart-attention derivation layer from existing workflow fields.
- Integrated attention pills and attention-only filtering in Agency/Client option thread lists.
- Aligned model inbox prioritization with the canonical attention rules.
- Added/extended tests for attention semantics and assignment integration boundaries.
- Added additive guardrails and docs to keep attention/assignment strictly workflow-only.

## Risk

- Low-to-medium UI behavior risk (sorting/filtering and additional badges in thread lists).
- No auth/admin/login/paywall/RLS path modifications.
- No schema or migration changes.

## Test linkage

- `npm run typecheck`
- `npm run lint`
- `npm test -- --passWithNoTests --ci`
- Unit coverage extended in:
  - `src/utils/__tests__/optionRequestAttention.test.ts`
  - `src/utils/__tests__/statusHelpers.test.ts`
  - `src/services/__tests__/clientAssignmentsSupabase.test.ts`
