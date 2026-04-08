# CURSOR_INVITE_AND_PHOTO_INCIDENT_REPORT

## 1. Executive Summary

Two production issues were addressed with **minimal, evidence-based** changes: (A) model claim finalization could fail after email confirmation because **`signIn` ignored a persisted claim token unless `isModelClaimFlowActive()` was set**, while **`signUp` read the token whenever present**; (B) clients could pass `model_photos` RLS but **fail `documentspictures` SELECT** because **`can_view_model_photo_storage` gated clients on `models.is_visible_*` instead of aligning with per-photo visibility and paywall**.

## 2. Invite / claim / signup root cause(s)

- **Primary (Incident A):** `CONFIRMED_SIGNIN_VS_SIGNUP_CLAIM_TOKEN_READ_ASYMMETRY` in [`AuthContext.tsx`](src/context/AuthContext.tsx) — `signIn` used `(await isModelClaimFlowActive()) ? await readModelClaimToken() : null`; `signUp` used `await readModelClaimToken()` unconditionally.

## 3. Model assignment / linking analysis

- Canonical link: `claim_model_by_token` after auth. Agency association lives on the `models` row / territories; linking sets `models.user_id`.
- Deprecated: `link_model_by_email()` still runs in isolated Step 2 — unchanged.

## 4. Invite email / copy analysis

- **Resend (`send-invite`)** model template: “Create My Account” + claim URL — aligned with flow.
- **Supabase Auth** sends confirmation mail (wording from dashboard, not repo). Added a short note in the **model claim** HTML that users should confirm email if prompted and may reuse the invitation link if the profile does not connect after first login.

## 5. Client photo visibility root cause(s)

- **Primary (Incident B):** `CONFIRMED_STORAGE_VISIBILITY_MISMATCH` — [`model_photos` client policy](supabase/migrations/20260426_remediation_three_policies_no_profiles_rls.sql) vs legacy [`can_view_model_photo_storage`](supabase/migrations/20260406_fix_storage_policies_secdef.sql) client branch (model-level `is_visible_commercial` / `is_visible_fashion` only).

## 6. What was fixed

### 6a AuthContext — before / after (signIn claim block only)

**Before:**

```ts
const { isModelClaimFlowActive, readModelClaimToken, persistModelClaimToken } =
  await import('../storage/modelClaimToken');
const claimTok = (await isModelClaimFlowActive()) ? await readModelClaimToken() : null;
```

**After:**

```ts
const { readModelClaimToken, persistModelClaimToken } =
  await import('../storage/modelClaimToken');
const claimTok = await readModelClaimToken();
```

(`signUp` already used `await readModelClaimToken()`; unchanged.)

- **AuthContext (exception A, minimal):** **only** this block and import list in `signIn`; no other auth changes.
- **SQL:** New migration drops/recreates `can_view_model_photo_storage(text)` with **full object path** semantics and **client branch** matching `model_photos` + `has_platform_access()` + `caller_is_client_org_member()`; `documentspictures_select_scoped` calls `can_view_model_photo_storage(name)`.
- **send-invite:** Clarifying paragraph for post-confirm / link reuse.

## 7. Rules decision

- Added global guardrails in [`.cursorrules`](.cursorrules), [`auto-review.mdc`](.cursor/rules/auto-review.mdc), [`system-invariants.mdc`](.cursor/rules/system-invariants.mdc) — see [`CURSOR_INVITE_AND_PHOTO_PLAN.json`](CURSOR_INVITE_AND_PHOTO_PLAN.json).

## 8. Why Auth / Admin / Login stayed safe

- **No** change to `bootstrapThenLoadProfile`, Step 1 ordering, admin detection RPCs, `get_my_org_context`, paywall ordering, or `App.tsx` routing.
- **Only** the model-claim `signIn` try-block: token read parity with `signUp`.

## 9. What must work reliably now

- Persisted model claim token is consumed on **both** first sign-up (when session exists) **and** subsequent sign-in when the token remains in storage.
- Clients who may SELECT a client-visible `model_photos` row can **sign** the corresponding `model-photos/...` object in `documentspictures`.

---

**Status label:** `INVITE AND PHOTO INCIDENTS FIXED`

**Big security audit A:** Reasonable to proceed; no open blocker from these two incidents beyond standard regression passes (`CURSOR_INVITE_AND_PHOTO_VERIFY.md`).
