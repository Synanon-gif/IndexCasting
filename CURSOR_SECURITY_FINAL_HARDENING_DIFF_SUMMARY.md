# CURSOR_SECURITY_FINAL_HARDENING_DIFF_SUMMARY

**Risk level:** LOW (client-only validation, clamps, debounce, URL guards; no backend or business-rule changes).

## Files touched

| Area | Files |
|------|--------|
| Limits / exports | [`lib/validation/limits.ts`](lib/validation/limits.ts) (new), [`lib/validation/index.ts`](lib/validation/index.ts) |
| Tests | [`lib/validation/__tests__/validation_hardening.test.ts`](lib/validation/__tests__/validation_hardening.test.ts) |
| Messenger / chat UI | [`src/components/OrgMessengerInline.tsx`](src/components/OrgMessengerInline.tsx), [`src/views/BookingChatView.tsx`](src/views/BookingChatView.tsx) |
| Services | [`src/services/messengerSupabase.ts`](src/services/messengerSupabase.ts), [`src/services/recruitingChatSupabase.ts`](src/services/recruitingChatSupabase.ts), [`src/services/optionRequestsSupabase.ts`](src/services/optionRequestsSupabase.ts), [`src/services/calendarSupabase.ts`](src/services/calendarSupabase.ts) |
| Agency model form | [`src/views/AgencyControllerView.tsx`](src/views/AgencyControllerView.tsx) |
| Client web / model | [`src/web/ClientWebApp.tsx`](src/web/ClientWebApp.tsx), [`src/screens/ModelProfileScreen.tsx`](src/screens/ModelProfileScreen.tsx) |
| Query params | [`src/utils/queryParamGuards.ts`](src/utils/queryParamGuards.ts) |
| Billing / legal | [`src/components/OwnerBillingStatusCard.tsx`](src/components/OwnerBillingStatusCard.tsx), [`src/screens/PaywallScreen.tsx`](src/screens/PaywallScreen.tsx), [`src/screens/TermsScreen.tsx`](src/screens/TermsScreen.tsx), [`src/screens/PrivacyScreen.tsx`](src/screens/PrivacyScreen.tsx) |
| Deliverables | `CURSOR_SECURITY_FINAL_HARDENING_*.md`, `CURSOR_SECURITY_FINAL_HARDENING_PLAN.json` |

## Notes

- `queryParamGuards` imports `stripInvisibleChars` from [`lib/validation/normalize.ts`](lib/validation/normalize.ts) directly to avoid pulling the full validation barrel (and transitive test deps) into lightweight Jest tests.
