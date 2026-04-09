# CURSOR_GLOBAL_SYSTEM_AUDIT_VERIFY.md

Manual and automated verification for the Global System Audit (2026-04-09).

## Automated (required)

- `npm run typecheck` — pass  
- `npm run lint` — pass  
- `npm test -- --passWithNoTests --ci` — pass  

## Manual — Agency Add Model (media mirrors)

1. As Agency, open **My Models** → Add model with **polaroid files only** (no portfolio), complete rights flow, save.  
2. **Expected:** `models.polaroids` matches visible polaroid rows in `model_photos` (packages/guest contexts); no reliance on opening the media panel first.  
3. Add model with **portfolio only** — portfolio mirror still rebuilds as before.  
4. Add model with **both** — both mirrors updated after upload block.

## Manual — Merge reactivate error path (regression guard)

1. Hard to force without DB tooling; smoke: merge/add flow still succeeds for normal **unowned** and **same-agency** cases.  
2. If `agency_update_model_full` fails after a failed claim, user should see **Could not add model** / thrown message instead of a green “merged” banner.

## Manual — Roster refresh heal

1. Seed or simulate a model with rows in `model_photos` but empty `portfolio_images` (legacy drift).  
2. Reload agency dashboard / trigger `refreshAgencyModelLists`.  
3. **Expected:** Thumbnails recover when possible; polaroid mirror also reconciled for those candidates.

## Manual — Invite (unchanged behavior)

1. Add model with email — success note only if `send-invite` returns `ok: true` in body.  
2. Failure — manual claim link + spam hint still expected per existing copy.

## Manual — Location (no code change)

1. Agency add with country + city — geocode failure should **not** write null coords (existing behavior).  
2. **Note:** `upsertModelLocation` failure still only warns in console; optional follow-up: surface Alert.

## Auth smoke (no code change)

1. Sign in as Agency Owner — `bootstrapThenLoadProfile` completes; no duplicate profile load loops in normal conditions.
