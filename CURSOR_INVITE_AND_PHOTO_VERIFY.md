# CURSOR_INVITE_AND_PHOTO_VERIFY

## Automated (run in repo root)

- `npm run typecheck` — pass
- `npm run lint` — pass
- `npm test -- --passWithNoTests --ci` — pass

## Database

- Migration `20260501_can_view_model_photo_storage_client_row_alignment.sql` applied via Supabase Management API — HTTP 201.
- Live verify: `can_view_model_photo_storage` identity args = `p_object_name text`.

## Edge

- `npx supabase functions deploy send-invite` — success (project `ispkfdqzjrfrilosoklu`).

## Manual checks (product)

1. **Normal login** — Agency booker / client employee: unchanged; no claim token in storage.
2. **Admin login** — No claim path; Step 1 bootstrap unchanged.
3. **Booker invite** — `?invite=` flow; accept after sign-in still via existing Step 2 block (unchanged).
4. **Client employee invite** — Same as Booker.
5. **Model claim** — Open `?model_invite=` link, persist token, **sign up** with confirm email if enabled, then **sign in** in a session where token may exist without `FLOW_KEY`: claim should run (parity fix).
6. **Model claim mail** — New copy mentions confirm email and reopening invite link if needed.
7. **Client photos** — Agency uploads portfolio with `is_visible_to_clients`; client org with platform access can load images (signed URL succeeds, no grey tiles) even when model is not fashion/commercial discoverable.
8. **No regression** — Paywall, admin routing, `get_my_org_context` untouched.
