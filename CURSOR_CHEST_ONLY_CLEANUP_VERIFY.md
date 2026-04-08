# Chest-only cleanup — verification

## Automated

- [ ] `npm run typecheck` — exit 0
- [ ] `npm run lint` — exit 0
- [ ] `npm test -- --passWithNoTests --ci` — exit 0
- [ ] (Optional) `npx playwright test e2e/guest-link.spec.ts` — if E2E is configured

## Manual — product UI (English)

- [ ] Grep `src/` for user-visible strings: no `Bust`, `Chest / Bust`, or `Chest / bust` in UI copy or JSX text (allow `bust` in identifiers, API field access, and comments).
- [ ] Agency model edit: chest field label shows **Chest (cm)** (`uiCopy.modelEdit.chestLabel`).
- [ ] Agency My Models completeness banner: missing measurement shows **Chest measurement missing.** (no “bust”).
- [ ] Client swipe / discovery customer path: measurement label **Chest (cm)**; value reflects data when only legacy `bust` is populated (`chest ?? bust`).
- [ ] Model app profile tab: measurements row uses **Chest (cm)** and shows correct number when DB has only `bust`.
- [ ] Guest package + shared selection: still show **Chest** + **cm** (unchanged templates; data from `bust` where applicable).
- [ ] Client web project overview: meta line includes **Chest N cm** (and waist/hips with cm).

## Non-regression (scope)

- [ ] No changes to sign-in, `bootstrapThenLoadProfile`, org context RPCs, admin dashboard RPCs, paywall flows, or `calendar_entries` policies.

## Guest link E2E note

Assertions intentionally look for **chest** (lowercased body text) instead of **bust**, matching post-cleanup UI.
