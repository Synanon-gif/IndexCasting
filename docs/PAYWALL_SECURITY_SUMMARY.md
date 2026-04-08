# Paywall & Subscription — Security Summary (IndexCasting)

Binding product and technical rules for **Agency** and **Client** B2B organizations. This document reflects the code and migrations in this repository; verify live DB after any RPC change (`pg_get_functiondef`, see `docs/LIVE_DB_DRIFT_GUARDRAIL.md`).

---

## 1. Product rules

- **Owner-only (billing responsibility):** Only the organization **owner** may initiate Stripe Checkout and manage billing for that org. Booker / Employee parity applies to day-to-day product features, **not** to owner-only areas (billing checkout, member invite/remove and org delete as enforced elsewhere in product rules).
- **Org-wide access:** When the org has platform access (trial, subscription, or admin override), **all** members of that org share that access state for gated features. Access is not per-seat in the UI sense for the paywall gate.
- **Admin:** Platform admin uses separate admin RPCs (`assert_is_admin()`); admin dashboard routing does not depend on org subscription.

---

## 2. Technical truth

- **Paywall is org-wide:** Derived from the org tied to the caller via `organization_members` (see below), not from a client-supplied org id in `can_access_platform()`.
- **Org context for paywall:** Resolved **server-side** in `public.can_access_platform()` from `auth.uid()` → join `organization_members` and `organizations`, **`ORDER BY om.created_at ASC LIMIT 1`**. Same deterministic “oldest membership” semantics as `create-checkout-session` when `org_id` is omitted. Documented exception vs “no implicit org resolution” for **auth/org-switching** UX: paywall is explicitly scoped to one org for enforcement (see `supabase/migrations/20260417_fix_c_can_access_platform_limit1_doc.sql`).
- **Client cannot spoof org for RPC:** `can_access_platform()` takes no parameters; org id comes only from membership rows for `auth.uid()`.

---

## 3. Decision order (mandatory)

Exact order implemented in `can_access_platform()` (latest definition in `supabase/migrations/20260416_fix_a_can_access_platform_sha256.sql`):

1. **admin_override** — row in `admin_overrides` for resolved `organization_id` with `bypass_paywall = true` → allow.
2. **trial_active** — `organization_subscriptions.trial_ends_at > now()` → allow, unless blocked by `used_trial_emails` (same email hash already used for a trial on a **different** org).
3. **subscription_active** — `organization_subscriptions.status IN ('active', 'trialing')` → allow.
4. **deny** — otherwise `allowed: false`, e.g. `no_active_subscription`, or `trial_already_used`, or `no_org` (no membership row).

`public.has_platform_access()` is a thin wrapper: `(can_access_platform()->>'allowed')::boolean` for use in SQL policies and some RPCs.

---

## 4. Stripe = payment truth

- Checkout creates subscriptions and metadata; **Edge Function** `create-checkout-session` validates JWT, resolves org from `organization_members`, requires **`role === 'owner'`** for checkout, and uses Stripe price env secrets.
- **Edge Function** `stripe-webhook` verifies Stripe signature and upserts `organization_subscriptions` (with subscription linking checks). No frontend trust.

---

## 5. Database = access truth

- `organization_subscriptions` and `admin_overrides` drive `can_access_platform()`.
- RLS and RPCs that call `has_platform_access()` / `can_access_platform()` enforce access for paths that must not rely on UI alone (e.g. client-visible model photos policy in `20260426_remediation_three_policies_no_profiles_rls.sql`, discovery RPCs such as `get_models_by_location` / near-location stack).

---

## 6. Frontend must never decide alone

- `SubscriptionContext` + `getMyOrgAccessStatus()` mirror RPC output for **UI** (paywall screen, guards). **Bypassing the UI does not grant API access** if RLS/RPC still enforce.
- Services such as `modelsSupabase.assertPlatformAccess` and `clientDiscoverySupabase.assertPlatformAccess` call `can_access_platform` before broad queries where RLS may be permissive.

---

## 7. Fail-closed behavior

- `getMyOrgAccessStatus()` on RPC/network error returns **`allowed: false`** (fail-closed). The `reason` may be `'no_org'` as a generic blocked sentinel; distinguish failures via **logs** (`MANUAL_REVIEW_REQUIRED` if product needs a distinct UX reason code).

---

## 8. Admin override (org-scoped, auditable)

- Writes go through **`admin_set_bypass_paywall`** (SECURITY DEFINER, `assert_is_admin()`), not direct table writes from clients.
- Admin UI uses `adminSetBypassPaywall` in `src/services/adminSupabase.ts` with admin logging.

---

## 9. Components in the gate (reference)

| Layer | Role |
|------|------|
| `can_access_platform()` | Single JSONB source of truth for access reasons |
| `has_platform_access()` | Boolean wrapper for policies / SQL |
| `create-checkout-session` | Owner-only checkout; org from JWT |
| `stripe-webhook` | Syncs Stripe → `organization_subscriptions` |
| `SubscriptionContext` / `PaywallScreen` | UI; `App.tsx` Client/Agency paywall guards (do not change without security review) |
| `assertPlatformAccess` (client discovery / models) | Extra client-side check before queries; server still enforces |

---

## 10. Common no-go patterns

- Trusting plan labels or cached UI state as authorization.
- Adding features that mutate org data without RPC/RLS checks aligned with `can_access_platform()` where appropriate.
- Letting non-owners complete checkout (blocked in Edge Function; mirror in UI via `PaywallScreen` / `org_member_role === 'owner'`).
- Assuming `profiles` or client-supplied `organization_id` for paywall without membership verification.
- Putting **models** on `organization_members` for paywall — breaks Fix H; model flows use `model_agency_territories` / `get_my_model_agencies()`.

---

## Model role vs B2B paywall

Users with `role === model` typically have **no** `organization_members` row for agency linkage. `can_access_platform()` then returns `reason: 'no_org'`. **Model workspace is not wrapped in the same Client/Agency paywall guards** in `App.tsx`; model-specific RPCs do not uniformly use `has_platform_access()` — intentional scope: B2B subscription product for client/agency orgs.
