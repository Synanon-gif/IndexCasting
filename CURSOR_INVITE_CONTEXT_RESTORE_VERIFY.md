# CURSOR_INVITE_CONTEXT_RESTORE_VERIFY

Manual checks (web unless noted):

1. **Persisted org invite, no `?invite=`**  
   - Open app with valid `?invite=<token>`, let token persist (or set `localStorage` key `ic_pending_invite_token`), remove query from URL and reload.  
   - **Expect:** Invite gate or `AuthScreen` with invite context (not generic self-service); no success banner before RPC.

2. **Persisted model claim, no `?model_invite=`**  
   - Same with `ic_pending_model_claim_token` and no org invite token.  
   - **Expect:** Model claim gate or model-scoped `AuthScreen`; no org-invite UI.

3. **Invite + claim in storage**  
   - **Expect:** Only invite flow (matches finalize order).

4. **Plain auth**  
   - No pending keys / empty storage.  
   - **Expect:** Unchanged generic auth; `clearStaleInviteOnSignIn` still true when no tokens.

5. **Telemetry**  
   - Storage-only restore: FLOW_KEY markers should not be set by restore path (only URL path calls `mark*FlowFromUrl`).

6. **Regression sanity**  
   - Admin login, normal agency/client login, paywall screens unchanged (no edits there).

Automated:

- `npm run typecheck`
- `npm run lint`
- `npm test -- --passWithNoTests --ci`
