# CURSOR_OWNER_BILLING_UX_DIFF_SUMMARY.md

| File | Purpose | Risk | Tests |
|------|---------|------|--------|
| [`src/components/OwnerBillingStatusCard.tsx`](src/components/OwnerBillingStatusCard.tsx) | Owner billing/trial/plan card; web billing return banner; trial subscribe CTA | Low — read-only + existing checkout API | Manual / VERIFY |
| [`src/constants/planFeatures.ts`](src/constants/planFeatures.ts) | Plan labels + feature bullets for UI | Low — mirrors Paywall | [`planFeatures.test.ts`](src/constants/__tests__/planFeatures.test.ts) |
| [`src/utils/stripeSandboxUi.ts`](src/utils/stripeSandboxUi.ts) | `EXPO_PUBLIC_STRIPE_SANDBOX` helper | Low | — |
| [`src/constants/uiCopy.ts`](src/constants/uiCopy.ts) | New billing / paywall / owner strings | Low | — |
| [`src/screens/PaywallScreen.tsx`](src/screens/PaywallScreen.tsx) | Hardcodes → uiCopy | Low | — |
| [`src/views/AgencyControllerView.tsx`](src/views/AgencyControllerView.tsx) | Embed billing card (settings) | Low | — |
| [`src/web/ClientWebApp.tsx`](src/web/ClientWebApp.tsx) | Embed billing card (team) | Low | — |
| [`.env.example`](.env.example) | Document `EXPO_PUBLIC_STRIPE_SANDBOX` | None | — |
| [`docs/OWNER_BILLING_ONBOARDING.md`](docs/OWNER_BILLING_ONBOARDING.md) | Short journey doc | None | — |

**Not changed:** `AuthContext.tsx`, `App.tsx`, `SubscriptionContext.tsx` internals, SQL, Edge Function contracts.
