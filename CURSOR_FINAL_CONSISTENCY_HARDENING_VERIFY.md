# CURSOR Final Consistency Hardening Verify

## Automated checks

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test -- --passWithNoTests --ci`

## Manual QA Matrix (Final)

| Area | Steps | Expected |
|---|---|---|
| A. Agency model media | Upload portfolio image -> set visible to clients -> save (if profile edits pending) -> reload page -> open roster row -> open media panel | Thumbnail visible in roster, media panel shows uploaded asset, completeness does not falsely show “No visible portfolio photo” when visible row exists |
| B. Client visibility | Login as eligible client -> open discovery/grid + detail modal for model with visible portfolio row | Image resolves (no broken tile), no `ERR_UNKNOWN_URL_SCHEME`, detail uses `Chest` label |
| C. Location consistency | In Agency My Models set country + city + current location -> save -> reload -> re-open roster + editor + near-me-relevant view | Saved values remain consistent across roster/editor; location hint/badge matches expected source behavior |
| D. Invite transparency | Create/merge model with email in agency flow | UI always shows one deterministic outcome: email sent, explicit skip reason (already linked/claimed), or failure with manual claim-link fallback |
| E. Package behavior | Open standard discovery and package/guest contexts | Standard discovery shows portfolio only; polaroids appear only in selected package/guest polaroid context |

## Exact manual checks by incident strand

### 1) Agency media persistence

- [ ] Upload + visibility toggle + reload keeps roster thumbnail and panel aligned.
- [ ] Completeness critical check follows `model_photos` visible rows.

### 2) Client visibility

- [ ] Client can load visible portfolio photos for allowed models.
- [ ] No unresolved custom scheme / raw filename image URL reaches web `<Image uri>`.
- [ ] Client-facing measurement copy remains Chest-only.

### 3) Location persistence

- [ ] Country/city/current location survive save + reload.
- [ ] No misleading mismatch between form state and roster state after refresh.

### 4) Invite dispatch transparency

- [ ] Success path confirmed where mail provider works.
- [ ] Token-created-but-mail-failed path surfaces manual link.
- [ ] Already linked path surfaces explicit skip text (not generic failure).

### 5) Package image semantics

- [ ] Normal discovery remains portfolio-only.
- [ ] Polaroids render only in selected package/guest polaroid context.
