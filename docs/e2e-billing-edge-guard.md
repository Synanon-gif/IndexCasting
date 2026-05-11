# E2E billing Edge guard (no external side effects)

Purpose: allow Full E2E against a real app + Supabase **without** creating Stripe Checkout sessions, finalizing/sending Stripe invoices, sending invoice e-mail via Resend, or cancelling subscriptions via Stripe from selected Edge Functions.

## Where it lives

- Shared helper: `supabase/functions/_shared/e2eBillingGuard.ts`
- Wired into:
  - `create-checkout-session`
  - `send-invoice-via-stripe`
  - `send-invoice-via-email`
  - `stripe-cancel-dissolved-org`

## Configuration (Supabase Edge secrets)

Set on the **Supabase project** (Dashboard → Edge Functions → Secrets), not in `EXPO_PUBLIC_*` or Playwright `.env.e2e` unless you duplicate for operator notes only.

| Secret | Value | Effect |
|--------|--------|--------|
| `E2E_BILLING_NO_EXTERNAL_SIDE_EFFECTS` | `I_UNDERSTAND` | Blocks all four functions’ external calls (Stripe + Resend). |
| `E2E_STRIPE_LIVE_EXTERNAL_BLOCK` | `I_UNDERSTAND` | **Optional.** Blocks **Stripe-only** paths when `STRIPE_SECRET_KEY` starts with `sk_live_`. Does not block Resend. |

When **neither** condition applies, behavior is unchanged from before the guard existed.

## HTTP behavior

- `create-checkout-session` (browser `fetch`): **409** + JSON `blocked`, `code: e2e_billing_external_side_effect_blocked`.
- Functions invoked via `supabase.functions.invoke`: **200** + same JSON body (`ok: false`) so clients can read `data` without Supabase treating non-2xx as empty body.

Logs use prefix `[e2e-billing-guard]` with `reason` and `stripe_key_mode` (`live` / `test` / `unknown` only — never key material).

## What stays allowed

DB-backed manual invoice drafts, previews, PDF generation, invoice numbers, paywall reads, and other paths that do not go through these four Edge entrypoints are unaffected by this guard.

## Rollback

Remove the Edge secrets (or set them to anything other than `I_UNDERSTAND`) and redeploy functions if needed; no migration or schema change is involved.
