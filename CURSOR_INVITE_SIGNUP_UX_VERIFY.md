# Invite Signup UX — Verification checklist

Manual checks (staging/production as appropriate):

1. **Sign-up gives clear email-confirmation feedback**  
   - Create a new user with email confirmation enabled on the Supabase project.  
   - After sign-up, `AuthScreen` must show the confirmation panel (no session) and “Back to login”.  
   - With confirmation disabled, no panel appears and the user proceeds with a session as before.

2. **Invite flows explain what happens next**  
   - Open a valid `?invite=` link: `InviteAcceptanceScreen` shows `inviteNextStepsAfterSignup`.  
   - Complete sign-up from invite: if no session, extra note `signUpEmailConfirmationInviteNote` appears.

3. **Model claim mail text matches actual flow**  
   - `send-invite` model_claim template unchanged in this pass (already had confirm + reopen link).  
   - `ModelClaimScreen` shows `modelClaimNextStepsAfterSignup`.  
   - After model-invite sign-up without session, `signUpEmailConfirmationModelClaimNote` appears.

4. **Booker invite and Client employee invite wording**  
   - Agency owner sends booker invite: email body shows **Booker**.  
   - Client owner sends employee invite: email body shows **Employee** (`invite_role: 'employee'`).  
   - Org email includes paragraph: confirm email if prompted → sign in → membership finalizes; same link may be reopened before expiry.

5. **UI does not claim completion too early**  
   - No new “invitation accepted” or “claim complete” messages on sign-up alone; only email-check / next-step guidance.  
   - Finalization remains in `finalizePendingInviteOrClaim` after session exists.

6. **No auth/admin/paywall regression**  
   - `npm run typecheck`, `npm run lint`, `npm test -- --passWithNoTests --ci` — all green.  
   - `AuthContext` `bootstrapThenLoadProfile` / sign-in Step 1 not modified.

## Edge Function deploy

- Deployed: `npx supabase functions deploy send-invite --no-verify-jwt --project-ref ispkfdqzjrfrilosoklu` (success).
