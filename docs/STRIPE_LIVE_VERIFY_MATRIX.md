# Stripe Live — Verify Matrix (final smoke wave)

Use this matrix **before** switching production to Stripe Live keys, and **again** after the switch. Mark each cell Pass/Fail and note environment (staging vs prod).

**Legend:** RPC = `can_access_platform()`; UI = client screens; EF = Edge Function.

| # | Scenario | Steps | Expected | Pass |
|---|----------|-------|----------|------|
| **Agency Owner** |
| A1 | Trial visible | Log in as Agency Owner; Settings → Billing card | Trial days / end date shown when RPC `trial_active` | |
| A2 | Plan visible | Same | Plan label aligns with DB `organization_subscriptions.plan` or RPC | |
| A3 | Checkout CTA | Same | Subscribe/upgrade CTA only when product rules say so (e.g. trial); button calls `createCheckoutSession` | |
| A4 | Checkout success | Complete Checkout (test or live per phase) | Redirect to `/billing/success`; banner + refresh; access matches RPC after webhook | |
| A5 | Checkout cancel | Cancel from Stripe Checkout | `/billing/cancel` banner; no bogus “paid” state | |
| **Agency Booker** |
| B1 | No checkout | Log in as Booker; Settings | Read-only billing copy; **no** checkout button | |
| B2 | Org usage | Booker with active org access | Normal agency features; RPC gates writes | |
| **Client Owner** |
| C1 | Trial / plan / CTA | Client Owner; Team tab | Same expectations as A1–A3 in client variant | |
| C2 | Success/cancel | Same as A4/A5 | Same | |
| **Client Employee** |
| D1 | No checkout | Employee; Team | Read-only billing; no checkout | |
| D2 | Usage | Employee with access | Normal client features | |
| **Admin** |
| E1 | No paywall lockout | Admin account | Reaches Admin dashboard; no B2B paywall guard | |
| E2 | Unchanged auth | Login/logout | No regression (no code change expected in this release) | |
| **Fail-closed** |
| F1 | RPC error | Simulate network/RPC failure if safe | `getMyOrgAccessStatus` → `allowed: false`, `reason: 'no_org'`; user not silently granted access | |
| **Success / Cancel URLs** |
| G1 | URL cleanup | Web only | After success/cancel, URL stripped to `/` and banner shown once | |
| G2 | Refresh | Same | `useSubscription().refresh()` invoked on success path | |
| **Webhook → DB** |
| H1 | checkout.session.completed | Stripe test/live event | `organization_subscriptions` upserted; `plan` from session metadata | |
| H2 | subscription.updated | Change plan in Stripe | DB `plan`/`status` update; swipe limits updated for agency plans in webhook handler | |
| **Plan / feature mapping** |
| I1 | Features vs plan | Owner billing card + Paywall | Feature bullets match marketing limits (`planFeatures.ts` / `PLAN_LIMITS`); not a second entitlement layer | |
| **Trial already used** |
| J1 | RPC `trial_already_used` | Account/email scenario per `used_trial_emails` | Paywall or denied access; Owner sees clear copy; **no** trial abuse | |

## Notes

- **past_due:** Webhook maps Stripe `past_due` to DB status `past_due`. RPC **does not** treat `past_due` as paid access — org is denied until `active`/`trialing`. Verify this is intended.
- **incomplete:** Mapped to `canceled` in webhook for DB enum compatibility — access denied via RPC unless trial/other path applies.
- **Multi-org:** RPC and `getMyOrgSubscription` use oldest membership — document which org was billed if user has multiple memberships (`MANUAL_REVIEW_REQUIRED` for product).
