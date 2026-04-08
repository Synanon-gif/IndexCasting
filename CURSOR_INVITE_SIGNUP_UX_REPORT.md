# CURSOR_INVITE_SIGNUP_UX_REPORT.md

## 1. Executive Summary

Invite/signup/claim flows now communicate pending email confirmation when Supabase returns no session after sign-up, spell out confirm → sign-in → finalization on invite and model-claim gates, and fix organization invitation emails so client **Employee** invites are not labeled **Booker**. The `send-invite` Edge Function was deployed to project `ispkfdqzjrfrilosoklu`. Auth bootstrap and admin paths were not touched.

## 2. Missing / misleading feedback states

| Area | Classification | Resolution |
|------|----------------|------------|
| No message after sign-up when `session` is null | CONFIRMED_MISSING_FEEDBACK | `AuthScreen` + `uiCopy.auth.signUpEmailConfirmation*` |
| Invite/model gates silent on email confirm order | CONFIRMED_MISSING_FEEDBACK | `invite.inviteNextStepsAfterSignup`, `modelClaim.modelClaimNextStepsAfterSignup` |
| Org Resend email always said “Booker” | CONFIRMED_MISLEADING_COPY | `invite_role` + template uses Employee/Booker correctly |

## 3. Email copy findings

- **Org invitation:** Added paragraph aligned with app behavior: optional email confirmation, sign-in, membership finalizes on first successful sign-in, same link reusable before expiry. Adjusted CTA copy to “open invitation and create or sign in” (not implying one-click completion).  
- **Role label:** `invite_role` in JSON body; default `booker` if omitted (backward compatible).  
- **Model claim:** Unchanged in this pass; already documented confirm + reopen link.

## 4. UX states introduced or clarified

- **waiting_for_email_confirmation:** Shown on `AuthScreen` after sign-up when `getSession()` has no session.  
- **invite_or_claim_context:** Extra lines when `inviteAuth` or `modelClaimAuth` props are set.  
- **invite_sent / confirmation_required:** Clarified in gate screens and org email body (wording only).

## 5. What was fixed

- Centralized visible strings in `uiCopy` (auth subtitle, email/password placeholders, model claim banner).  
- `AuthScreen` post-signup flow and “Back to login”.  
- Gate screens: next-step hints.  
- `send-invite` org template + `invite_role`.  
- Documentation and auto-review bullet.

## 6. Rules decision

- **Added** a short bullet to [`.cursor/rules/auto-review.mdc`](.cursor/rules/auto-review.mdc) for invite/signup/claim copy and `send-invite` semantics.  
- **Not** duplicated into `.cursorrules` or `system-invariants.mdc` (single source in auto-review + doc).

## 7. Why auth/security core stayed untouched

- `signUp` / `signIn` / `bootstrapThenLoadProfile` signatures and Step-1 isolation unchanged.  
- Feedback uses `getSession()` in `AuthScreen` only; no new AuthContext contract.

## 8. What the user should now clearly understand

1. After sign-up they may need to **confirm email** before a session exists.  
2. **Sign in** after confirming; invite/claim **finalizes** with `finalizePendingInviteOrClaim` when a session exists.  
3. The **same invitation link** can be reopened (until expiry) if something did not complete.  
4. Invitation emails distinguish **Booker** vs **Employee** where applicable.

---

**INVITE SIGNUP UX HARDENING APPLIED**

**Suggested next step:** If remaining risk is product consistency, proceed with **Security Audit A**; if invite edge cases (multi-org, idempotency) are still open, **Invite Finalization Hardening** is the tighter follow-up.
