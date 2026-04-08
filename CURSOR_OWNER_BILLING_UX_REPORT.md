# CURSOR_OWNER_BILLING_UX_REPORT.md

## Executive Summary

Owner-facing **Billing & plan** awareness was missing while the organization still had platform access (trial or paid). Subscription state already existed in `SubscriptionContext` (mirroring `can_access_platform()`), but only `PaywallScreen` consumed it when access was blocked. This change adds an **OwnerBillingStatusCard** for Agency and Client workspaces, centralizes **plan feature copy** in `planFeatures.ts`, moves **PaywallScreen** strings into `uiCopy`, adds optional **Stripe sandbox** copy via `EXPO_PUBLIC_STRIPE_SANDBOX`, and handles **web checkout return** URLs (`/billing/success`, `/billing/cancel`) with a one-time banner and `refresh()` — without touching Auth, App routing, or paywall RPC logic.

## What improved (Owner Billing / Trial / Plan UX)

- **Agency:** Settings tab shows billing card for owner (full) and booker (read-only).
- **Client:** Team tab shows billing card for owner and employee (read-only).
- **Trial:** Days left, trial end date (when applicable), subscribe CTA during active trial (owner only).
- **Plans:** Display name + feature bullets aligned with existing paywall cards and `PLAN_LIMITS`.
- **Sandbox:** Optional prominent test-mode line when `EXPO_PUBLIC_STRIPE_SANDBOX=1`.
- **Paywall:** All previously hardcoded English strings moved to `uiCopy.billing`.

## Why Admin / Auth / Login stayed untouched

No edits to `AuthContext.tsx`, `App.tsx`, `signIn`, `bootstrapThenLoadProfile`, `loadProfile`, admin RPCs, or `get_my_org_context()`. The new UI only **reads** `useSubscription()`, `getMyOrgSubscription()`, and uses existing `createCheckoutSession` — same as `PaywallScreen`.

## Owner-only rules (visible + technical)

- **Checkout:** Only `profile.org_member_role === 'owner'` gets the subscribe button; Edge Function already returns 403 for non-owners.
- **Non-owners:** Read-only copy; no checkout control.
- **Access truth:** `can_access_platform()` remains authoritative; UI does not grant access.

## Stripe sandbox notes

- `EXPO_PUBLIC_STRIPE_SANDBOX` documented in `.env.example`.
- Copy explains test mode when the flag is set; generic “payments processed by Stripe” always.

## P1 analysis — dead code note

In `PaywallScreen`, the block that shows a **trial banner** when `isTrialActive && trialDaysLeft > 0` is **unreachable** in normal flow: `PaywallScreen` only renders when `isBlocked` is true, but an active trial implies `allowed === true`, so the user is not on the paywall. Left in place (no behavior change); documented here.

## Open points before Live Stripe

- Confirm **APP_URL** and Stripe redirect URLs for production.
- Optional: Stripe Customer Portal (not in scope; no backend change here).
- Multi-org users still resolve org the same way as existing subscription helpers (oldest membership) — document if product adds org switching.

## Verdict tag

**SAFE OWNER BILLING UX APPLIED**
