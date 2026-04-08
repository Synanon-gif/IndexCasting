# Owner billing onboarding

## After signup (Agency or Client owner)

1. **Platform access** is determined server-side by `can_access_platform()` (admin override → trial → subscription → deny).
2. **In-app:** Open **Agency → Settings** or **Client → Team** to see **Billing & plan** — trial status, plan label, included features, and (during trial) **Subscribe now**.
3. **Checkout** uses the existing `create-checkout-session` Edge Function; only **organization owners** can start checkout.

## Trial

- Remaining days and trial end date are shown when the server reports `trial_active`.
- Subscribe before the trial ends to avoid hitting the paywall when the trial expires.

## Plans

- Feature bullets match the marketing copy on the paywall and `PLAN_LIMITS` in code — enforcement remains on the server.

## Sandbox vs live Stripe

- Set `EXPO_PUBLIC_STRIPE_SANDBOX=1` in development/staging to show an explicit test-mode notice on the owner billing card.
- Before going live: unset the flag, configure live Stripe price IDs and webhooks, and confirm `APP_URL` matches your production domain for checkout redirects.

## Related code

- [`src/components/OwnerBillingStatusCard.tsx`](../src/components/OwnerBillingStatusCard.tsx)
- [`src/services/subscriptionSupabase.ts`](../src/services/subscriptionSupabase.ts)
- [`supabase/functions/create-checkout-session`](../supabase/functions/create-checkout-session/index.ts)
