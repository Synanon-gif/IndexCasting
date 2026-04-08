# Invite finalization — verification checklist

## Automated (local)

- [x] `npm run typecheck`
- [x] `npm run lint` (pre-existing warnings elsewhere may remain)
- [x] `npm test -- --passWithNoTests --ci` (includes `finalizePendingInviteOrClaim.test.ts`)

## Deploy

- [x] Migration `20260408_invite_claim_idempotent_finalization.sql` → Management API **HTTP 201**

## Manual (staging / prod)

1. **Model claim:** Open `?model_invite=…` → sign up (with confirm if enabled) → confirm email → sign in → model linked without re-opening link; reload with token cleared after success.
2. **Agency booker invite:** `?invite=…` → sign up / sign in with matching email → membership; repeat finalize (reload) → no duplicate error, still ok.
3. **Client employee invite:** Same as agency with client role.
4. **Logged-in + new tab:** While signed in, open invite link in new tab → after persist, membership/claim completes (or alert on fatal mismatch).
5. **Plain login:** Auth screen plain sign-in with `clearStaleInviteToken` still clears stale invite per existing policy.

## Live DB (optional)

```sql
SELECT proname FROM pg_proc
WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  AND proname IN ('accept_organization_invitation', 'claim_model_by_token');
```

Inspect `pg_get_functiondef` for both for idempotent branches.
