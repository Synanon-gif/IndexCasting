# CURSOR_STRIPE_LIVE_READINESS_REPORT.md

## 1. Executive Summary

This deliverable documents **Stripe Live go-live readiness** for IndexCasting: audit of checkout, webhook, subscription UI, and DB/RPC alignment; **operational checklists** ([`docs/STRIPE_LIVE_GO_LIVE_CHECKLIST.md`](docs/STRIPE_LIVE_GO_LIVE_CHECKLIST.md), [`docs/STRIPE_LIVE_VERIFY_MATRIX.md`](docs/STRIPE_LIVE_VERIFY_MATRIX.md)); and **harmless `.env.example` placeholders** for Edge Function secrets. **No** Auth, App shell, admin RPCs, or `can_access_platform()` logic was modified. **No** live keys were added to the repo.

## 2. Live readiness status

**From codebase review:** The stack is **structurally ready** for a controlled Live switch once **live** Stripe secrets, **live** Price IDs, and a **live** webhook endpoint are configured in Supabase and Stripe. Remaining risk is **operational** (wrong price ID, wrong webhook secret, `APP_URL` drift), not an undiscovered missing handler for core events.

## 3. What is already well secured

- **create-checkout-session:** JWT required; `organization_id` resolved server-side; **owner-only** checkout (`role === 'owner'` → 403 otherwise); Price IDs from env; redirect URLs allowlisted (HTTPS + origin list including `APP_URL`).
- **stripe-webhook:** Signature verification; `organization_id` validated against DB; **CRIT-03** subscription linking check; **idempotency** via `stripe_processed_events`; handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`.
- **Frontend:** `getMyOrgAccessStatus()` fail-closed on error; Owner billing UI does not bypass RPC; non-owners read-only.
- **Plan mapping:** Checkout writes `metadata.plan`; webhook maps Price IDs via env + metadata fallback on subscription updates.

## 4. Open risks / gaps (document, not “fixed” in code)

| Topic | Detail |
|-------|--------|
| **past_due vs access** | `can_access_platform()` allows subscription only for `active` and `trialing`. **`past_due` in DB denies access.** Confirm product expectation (grace period vs hard lockout). |
| **invoice.paid** | Upserts `status: 'active'` but does not refresh `plan` from price — usually OK if subscription.updated already ran; edge cases: document under manual review. |
| **Multi-org users** | Oldest `organization_members` row wins for RPC and `getMyOrgSubscription` — billing may not match “active team” if user has multiple orgs. |
| **UI optimism** | UI mirrors RPC; Owner card uses `getMyOrgSubscription` for display — can briefly disagree with RPC during webhook delay; user should refresh or rely on app refetch. |

## 5. Safe corrections applied (P4)

- **`.env.example`:** Added commented placeholders for Stripe Live / `APP_URL` / `EXPO_PUBLIC_APP_URL` (no real secrets).
- No webhook or checkout code changes in this pass (stability over nice-to-have).

## 6. Why Auth / Admin / Login stayed untouched

Per explicit scope: no edits to `AuthContext.tsx`, `App.tsx`, `signIn`, `bootstrapThenLoadProfile`, `loadProfile`, admin RPCs, or `get_my_org_context()`. Readiness is **configuration and verification**, not auth refactors.

## 7. Go / No-Go assessment

**Go** when live secrets, prices, webhook, and `APP_URL` are verified end-to-end and the Verify matrix passes in the target environment.

**No-Go** if webhook errors persist, Price IDs mismatch products, or production still has `EXPO_PUBLIC_STRIPE_SANDBOX=1`.

## 8. Recommended order for real Live switch

1. Create **live** Products/Prices in Stripe; copy Price IDs.
2. Create **live** webhook endpoint; copy signing secret.
3. Set Supabase Edge Function secrets (`STRIPE_*`, `APP_URL`, etc.); redeploy functions if required.
4. Set Vercel / `EXPO_PUBLIC_APP_URL` to production HTTPS.
5. Run Verify matrix (test charge with small amount or coordinated test account).
6. Monitor Stripe + Supabase logs 24–72h.

---

**Verdict tag: SAFE STRIPE LIVE READINESS APPLIED**
