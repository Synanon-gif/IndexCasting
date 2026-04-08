# Contextual Chat Layers — Diff Summary

## Changed files

- `src/constants/uiCopy.ts`
- `src/components/OrgMessengerInline.tsx`
- `src/web/ClientWebApp.tsx`
- `src/views/AgencyControllerView.tsx`
- `src/services/bookingChatIntegrationSupabase.ts`
- `src/store/optionRequests.ts`
- `src/services/__tests__/bookingChatIntegrationSupabase.test.ts`
- `src/services/__tests__/bookingChatPackageSource.test.ts`
- `docs/CONTEXTUAL_CHAT_LAYERS.md`
- `docs/OPTION_CASTING_FLOW.md`
- `CURSOR_CONTEXTUAL_CHAT_PLAN.json`
- `CURSOR_CONTEXTUAL_CHAT_REPORT.md`
- `CURSOR_CONTEXTUAL_CHAT_VERIFY.md`

## Purpose

- Clarify active chat context (`Negotiation thread` vs `Org chat`).
- Add minimal, safe quick-jump navigation between existing contexts.
- Keep architecture/security/visibility unchanged.

## Risk assessment

- **Low-to-medium UI glue risk:** changes are mostly local UI handlers and metadata wiring.
- **Low data risk:** only additive booking metadata (`option_request_id`) was introduced.
- **No auth/security/paywall risk intended:** no relevant core files modified.

## Test linkage

- Booking chat integration tests updated for additive metadata behavior.
- Full project verification run includes:
  - `npm run typecheck`
  - `npm run lint`
  - `npm test -- --passWithNoTests --ci`
