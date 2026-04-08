# Stripe Live — Go-Live Checklist

## 1. Goal and scope

Move production traffic from **Stripe Test mode** to **Stripe Live mode** for IndexCasting B2B billing (Agency/Client orgs), **without** changing application auth, admin routing, or paywall decision order. This checklist is **operational**: execute in order, record evidence, and use Go/No-Go before enabling live charges.

**Out of scope here:** changing `AuthContext`, `App.tsx`, `can_access_platform()` SQL, or RPC semantics — only configuration, secrets, Stripe Dashboard setup, and verification.

## 2. Secrets / environment variables (live)

### Supabase Edge Functions (Dashboard → Edge Functions → Secrets, or `supabase secrets set`)

| Secret | Purpose |
|--------|---------|
| `SUPABASE_URL` | Usually provided by platform |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only DB access in functions |
| `SUPABASE_ANON_KEY` | JWT verification in `create-checkout-session` |
| `STRIPE_SECRET_KEY` | **Live:** `sk_live_…` (replace test key) |
| `STRIPE_WEBHOOK_SECRET` | **Live:** signing secret from **live** webhook endpoint (`whsec_…`) |
| `STRIPE_PRICE_AGENCY_BASIC` | Live Price ID `price_…` |
| `STRIPE_PRICE_AGENCY_PRO` | Live Price ID |
| `STRIPE_PRICE_AGENCY_ENTERPRISE` | Live Price ID |
| `STRIPE_PRICE_CLIENT` | Live Price ID |
| `APP_URL` | **HTTPS** production app origin (no trailing slash per code convention); drives default success/cancel URLs |

### Frontend / Vercel (already in use)

| Variable | Purpose |
|----------|---------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Anon/publishable key |
| `EXPO_PUBLIC_APP_URL` | Must match production domain used in Stripe redirects and allowlists |
| `EXPO_PUBLIC_STRIPE_SANDBOX` | Set to `0` or **unset** in production so UI does not imply test mode |

**Never commit** real keys; use Dashboard / Vercel / CI secrets only.

## 3. Sandbox values to remove or replace

- Replace **test** `STRIPE_SECRET_KEY` (`sk_test_…`) with **live** `sk_live_…` in Supabase secrets.
- Replace all **test** Price IDs with **live** Price IDs (Products/Prices in Stripe Live mode).
- Create a **new live webhook endpoint** in Stripe (Live mode) pointing to your deployed `stripe-webhook` URL; copy the **new** `whsec_…` into `STRIPE_WEBHOOK_SECRET` (test secret must not be reused).
- Ensure `APP_URL` and `EXPO_PUBLIC_APP_URL` point to **production** HTTPS URLs, not staging, unless staging is intentionally the billing target.

## 4. Price IDs, products, redirect URLs

1. In **Stripe Dashboard (Live)**, confirm each product/price matches the internal plan: `agency_basic`, `agency_pro`, `agency_enterprise`, `client`.
2. Map each live Price ID to the corresponding Supabase secret (`STRIPE_PRICE_*`).
3. **Redirect URLs:** `create-checkout-session` defaults to `{APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}` and `{APP_URL}/billing/cancel`. Confirm `APP_URL` origin is in the allowlist (see `buildAllowedOrigins` in `supabase/functions/create-checkout-session/index.ts`).
4. In **Stripe Dashboard → Checkout settings**, ensure allowed domains/business settings align with your brand (optional but recommended).

## 5. Webhook configuration (live)

1. **URL:** `https://<project-ref>.supabase.co/functions/v1/stripe-webhook` (or your custom domain if configured).
2. **Mode:** Live — select events used by the handler (at minimum those implemented in code):
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
3. **Signing secret:** paste into `STRIPE_WEBHOOK_SECRET` for the **live** endpoint only.
4. **Idempotency:** Handler uses `stripe_processed_events` — do not truncate this table in production without ops approval.

## 6. Owner flows to test before Go-Live (staging with live-like config optional)

- **Agency Owner:** Settings → Billing card → trial visible → Subscribe opens Checkout → success return → access remains or becomes subscription-based per DB.
- **Client Owner:** Team tab → same.
- **Paywall (blocked org):** Owner can start checkout; non-owner sees read-only message only.

## 7. Roles to test explicitly

| Role | Billing checkout | Normal app when org allowed |
|------|------------------|-----------------------------|
| Agency Owner | Allowed (Edge Function enforces owner) | Full |
| Agency Booker | **Not** allowed (403 + UI read-only) | Full when `can_access_platform()` allows |
| Client Owner | Allowed | Full |
| Client Employee | **Not** allowed | Full when allowed |
| Admin | Not paywall-gated by this flow | Unchanged |

## 8. Access states to verify (`can_access_platform`)

Order is fixed in DB: **admin_override → trial_active → subscription_active → deny**.

| State | Expected UX |
|-------|-------------|
| `admin_override` | Access; Owner card shows override line |
| `trial_active` | Access; trial end / CTA as implemented |
| `subscription_active` | Access when `organization_subscriptions.status IN ('active','trialing')` per RPC |
| Deny (`no_active_subscription`, `trial_already_used`, etc.) | Paywall full-screen for B2B org type |

**Important:** DB function `can_access_platform()` grants subscription access only for statuses **`active` and `trialing`**. If Stripe/webhook writes `past_due`, the org **loses** platform access until status returns to `active`/`trialing`. Confirm this matches product/legal expectations before live.

## 9. DB / webhook / frontend sync checks

1. Complete a **test checkout** (small real charge or Stripe test mode in a **separate** dry run) and verify `organization_subscriptions` updates: `plan`, `status`, `stripe_customer_id`, `stripe_subscription_id`, `current_period_end`.
2. Confirm `stripe_processed_events` receives a row for the event id (no duplicate processing).
3. Reload app: `SubscriptionContext` refetches `can_access_platform()` — UI should not grant access without server `allowed: true`.
4. Owner billing card: `getMyOrgSubscription()` row visible where RLS allows; non-owners do not get checkout buttons.

## 10. Go / No-Go criteria

**Go** when all hold:

- Live secrets deployed and functions redeployed if needed.
- Live webhook delivers 2xx and DB rows update.
- At least one successful end-to-end owner checkout in target environment.
- `EXPO_PUBLIC_STRIPE_SANDBOX` off in production.
- Admin login and non-B2B routes regression-smoked.

**No-Go** if:

- Webhook returns 4xx/5xx consistently.
- Price ID mismatch (wrong plan in DB).
- `APP_URL` mismatch (redirect errors or open-redirect failures).

## 11. Rollback hints

- Revert Supabase secrets to previous values and redeploy functions (document who/when).
- Disable or pause live webhook endpoint in Stripe if emergency stop needed (payments may still retry — coordinate with Stripe support).
- Frontend rollback alone **does not** stop charges; Stripe and DB are source of truth.

## 12. Post Go-Live monitoring (first 24–72h)

- Stripe Dashboard → Payments, Disputes, Failed payments.
- Supabase logs for `stripe-webhook` and `create-checkout-session` errors.
- Support tickets: access after payment, duplicate charges, wrong org.

---

*See also: [STRIPE_LIVE_VERIFY_MATRIX.md](./STRIPE_LIVE_VERIFY_MATRIX.md), [PAYWALL_SECURITY_SUMMARY.md](./PAYWALL_SECURITY_SUMMARY.md).*
