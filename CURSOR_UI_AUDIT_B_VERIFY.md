# UI Audit B — Verification Checklist

Manual checks recommended after deploy (automated suite does not cover all UX).

## Invite / claim context clarity

- [ ] Open org invite link (`?invite=`) as new user: gate shows team invitation, not self-service org creation.
- [ ] Open model claim link (`?model_invite=`): copy distinguishes from Booker/Employee invite.
- [ ] After email confirmation + sign-in: success banner / membership or claim finalizes (reuse link still documented in uiCopy).

## Role lock clarity

- [ ] Invite gate shows locked role line (`inviteRoleLockedLine`) where applicable.
- [ ] Self-service signup: owner explanation vs invite path (`firstSignupCreatesOwner` vs invite hints).

## Success / pending messaging

- [ ] No “success” for org join before `finalizePendingInviteOrClaim` RPC success.
- [ ] Pending activation screen matches email-confirmation flow when enabled.

## Model edit / save clarity

- [ ] Agency My Models: completeness banner distinguishes critical vs recommended.
- [ ] Save territories vs full model save: user understands which action updates discovery (product expectation unchanged by this audit).

## Chest / bust / cm consistency

- [ ] Agency model edit panel: labels show **(cm)** for height, chest/bust, waist, hips, legs inseam.
- [ ] Client Discover card + package grid: **Chest** uses visible value; **cm** shown on overlay line.
- [ ] Guest package: grid + gallery overlay show **Chest N cm** (data from `bust` on guest RPC).
- [ ] Client filters: still **Chest (min–max)** in `ModelFiltersPanel` (unchanged; already cm-oriented).

## Upload / device / file type feedback

- [ ] HEIC pick on supported browser: converts or shows `uiCopy.common.heicConversionFailed` (or flow-specific alert).
- [ ] Chat file accept list includes expected types; rejection messages not silent (console + user alert where implemented).

## Client-visible photos

- [ ] When metadata says visible but storage denies: cross-check [`docs/CLIENT_MODEL_PHOTO_VISIBILITY.md`](docs/CLIENT_MODEL_PHOTO_VISIBILITY.md) — no change in this audit.
- [ ] Empty cover: placeholder behavior unchanged.

## No auth / admin / paywall regression

- [ ] Admin login and routing unchanged (no files touched).
- [ ] Agency/Client paywall guards in `App.tsx` unchanged.
- [ ] `calendar_entries` RLS not modified.

## Booking Brief trust model

- [ ] UI shows shared vs private badges; do **not** imply server-side per-field encryption or RLS on JSON keys — see [`docs/BOOKING_BRIEF_SYSTEM.md`](docs/BOOKING_BRIEF_SYSTEM.md).
