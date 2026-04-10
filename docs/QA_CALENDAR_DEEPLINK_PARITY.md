# QA — Calendar deeplinks & guest option requests

## Guest / no-session

- `addOptionRequest` in `src/store/optionRequests.ts` does not call the backend without `user.id`. If an optimistic stub was applied and the user is missing, the rollback path shows `uiCopy.alerts.optionRequestRequiresSignIn`.
- Package/guest flows that need option requests must run in an authenticated session; there is no parallel guest RPC in this store.

## Manual checks

1. **Client calendar**: Open a day with an option-linked entry → overlay → “Open negotiation” → Messages tab opens the correct thread; back returns to calendar when using the negotiation close flow (return ref).
2. **Agency calendar**: Same with search/focus on thread id.
3. **Booking-only row** with valid `option_request_id`: navigates to thread; without UUID, detail alert only (no fake thread).
4. **Model calendar**: Entry with `option_request_id` → “Open request” → Options tab + selected thread.
5. **Projection**: Linked model + `option_confirmed` + `model_approval` pending + `in_negotiation` shows awaiting-model badge for client/agency grid; model view shows “your confirmation” where applicable.
