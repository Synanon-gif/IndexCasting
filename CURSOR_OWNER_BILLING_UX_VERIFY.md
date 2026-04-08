# CURSOR_OWNER_BILLING_UX_VERIFY.md

Manual checks (staging / sandbox):

1. **New Agency Owner (trial):** Open Agency → Settings → see **Billing & plan** with trial days / end date, features, **Subscribe now** opens Stripe test checkout.
2. **New Client Owner (trial):** Open Client → Team → same expectations.
3. **Owner** sees checkout / subscribe CTA when trial is active (not when admin override).
4. **Booker (Agency):** Settings → billing block is **read-only** (no checkout button).
5. **Employee (Client):** Team → billing block is **read-only**.
6. **Org-wide access** unchanged — still enforced by `can_access_platform()` on the server.
7. **Fail-closed:** If RPC fails, existing guards still apply; card may show “could not verify” line.
8. **Checkout owner-only:** Non-owner cannot complete checkout (UI + existing Edge Function 403).
9. **Return from checkout (web):** After Stripe redirects to `/billing/success`, app shows success banner and URL is cleaned to `/`; subscription state refreshes.
10. **Admin / login path:** Unchanged (no Auth/App edits).

Automated: `npm run typecheck`, `npm run lint`, `npm test -- --passWithNoTests --ci` — all green.
