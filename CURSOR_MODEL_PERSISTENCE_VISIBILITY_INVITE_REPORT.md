# Model persistence, visibility, and invite — incident report

## 1. Executive summary

The incident combined **drift between `model_photos` and `models.portfolio_images`**, **unsafe `getPhotosForModel` query ordering** (`.order()` before `.eq('photo_type')` broke chained filters in the PostgREST client), **stale React state for profile completeness**, missing **URL normalization** on agency roster and client detail grids, **opaque model-invite email failures**, and **confusing image-rights checkbox semantics**. Fixes align denormalized portfolio arrays with `model_photos`, derive completeness from DB rows, surface sync and invite errors, document location/country behaviour, and normalize portfolio URLs before `StorageImage`.

## 2. Root causes by symptom

| Symptom | Cause |
|--------|--------|
| Agency: images “gone” after reload in roster | Roster used `portfolio_images[0]` without `normalizeDocumentspicturesModelImageRef`; drift if `syncPortfolioToModel` failed silently |
| Completeness: “no visible portfolio photo” wrong | `hasVisiblePortfolio` was callback-only and stale across model switch / save |
| Consent unstable | Checkbox reset on remount; server requires audit row — UX did not explain session + window |
| City / location confusion | `model_locations` agency write only when `country_code` set; not documented in form |
| Invite mail “not sent” | Only `invokeRes.error` checked; JSON body `error` ignored; no reason or manual claim URL |
| Client images | Detail grid used raw `portfolio` URLs; `getPhotosForModel` order bug could affect typed queries |

## 3. Persistence source of truth

- **Uploads / visibility:** `model_photos`
- **Discovery / roster cover list:** `models.portfolio_images` (kept in sync via RPC; rebuild helpers on media panel load)
- **Completeness critical “visible photo”:** `model_photos` portfolio rows with `is_visible_to_clients` (via `getPhotosForModel`)

## 4. Invite dispatch

Flow unchanged: `generateModelClaimToken` → Edge `send-invite` (Resend). UI now parses **response body** `ok` / `error`, maps codes to English text, and appends **`buildModelClaimUrl`** when the token exists but email failed.

## 5. Client image / Chest

- Detail modal: portfolio URLs normalized with `normalizeDocumentspicturesModelImageRef` and `data.id`
- Agency roster meta: **chest ?? bust** for display column
- Labels remain **Chest** via existing `uiCopy`

## 6. Security / visibility impact

- No change to RLS, Auth, paywall, or admin RPCs
- `getPhotosForModel` fix corrects filter order only (stricter alignment with intended `photo_type` filter)
- Reconcile runs in authenticated agency context; same RPC as existing sync

## 7. Rules / docs

- Updated: `docs/CLIENT_MODEL_PHOTO_VISIBILITY.md`, new `docs/MODEL_PROFILE_PERSISTENCE_AND_VISIBILITY.md`
- Cursor root rules not changed (scope limited)

## 8. Manual checks still required

- Production: Resend secret present; send-invite returns `ok: true` for model_claim
- Multi-org booker: `inviteOrganizationId` passed where needed
- Full QA: see `CURSOR_MODEL_PERSISTENCE_VISIBILITY_INVITE_VERIFY.md`

---

**Outcome label:** MODEL PERSISTENCE + VISIBILITY + INVITE INCIDENT FIXED (code + tests + docs in repo; live email still env-dependent).
