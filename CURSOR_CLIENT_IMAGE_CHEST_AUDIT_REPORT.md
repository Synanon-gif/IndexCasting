# Client image + Chest — audit report (2026-04-09)

## 1. Executive summary

Two production issues on the **client web Discover path** were traced to (1) **measurement labels** derived from API object keys combined with global **uppercase label typography**, and (2) **portfolio image URLs** passed to `<Image>` without resolving **private-bucket / custom-scheme** refs or **legacy bare filenames**. Both are fixed with **API shape + uiCopy**, **`normalizeDocumentspicturesModelImageRef`** (pure util, no Supabase in `apiService` import chain), **`StorageImage`** in `ClientWebApp`, and **guest signing** normalization. **No** changes to Auth, paywall ordering, invite/claim core, calendar RLS, or booking brief trust model.

## 2. Root cause — “BUST” label

- `getModelData` exposed `measurements.bust` as a **key**.
- `ProjectDetailView` rendered `Object.entries(data.measurements)` → label = raw key.
- `typography.label` uses **`textTransform: 'uppercase'`** → **`bust` → “BUST”**.

## 3. Root cause — image load / `ERR_UNKNOWN_URL_SCHEME`

- Discovery RPCs return raw **`portfolio_images`** (no server-side signing).
- Values may be **`supabase-storage://…`** (invalid as browser `img src`) or **bare filenames** (browser treats as unknown scheme).
- `ClientWebApp` used **`<Image source={{ uri }}>`** without **`StorageImage`** / `resolveStorageUrl`.

## 4. Fixed surfaces / code paths

| Area | Change |
|------|--------|
| `apiService.js` | `measurements.chest` (`chest ?? bust`); portfolio images mapped through normalizer |
| `ClientWebApp.tsx` | Detail modal: fixed rows + `uiCopy.discover.detailMeasurement*`; package/shared fallbacks use `chest`; `StorageImage` + TTL for covers/portfolio/lightbox; `normalize*` on all `coverUrl` sources |
| `SharedSelectionView.tsx` | `measurements.chest` type + display |
| `guestLinksSupabase.ts` | `signImageUrls(urls, modelId)` normalizes before path extract |
| `normalizeModelPortfolioUrl.ts` | New pure helper (Jest-safe for `apiService.js`) |
| `uiCopy.ts` | Discover detail measurement labels |

## 5. Security / visibility impact

- **No widening** of client-visible assets: normalization only repairs string shape for the **same model row**; signing/RLS unchanged.
- **Polaroids** remain package/guest-only; discovery still portfolio-only per existing rules.

## 6. Rules / docs decision

- Updated: `.cursorrules` §27.1–27.2, `.cursor/rules/auto-review.mdc`, `.cursor/rules/system-invariants.mdc`
- Added: `docs/DISCOVERY_IMAGE_AND_MEASUREMENT_CONSISTENCY.md`
- Updated: `docs/CLIENT_MODEL_PHOTO_VISIBILITY.md` (cross-link)

## 7. Remaining manual checks

- Spot-check **production** models whose files were **never** under `model-photos/{modelId}/` — images may still fail signing until **data backfill** (documented risk).
- Visual: Discover card, detail modal, project overview, package mode, lightbox, guest link, shared selection.
