# Discovery — client-visible images and measurements

## Measurements (Chest)

- **User-facing copy** must use **Chest** only — never the legacy DB field name **bust** as visible text or as a rendered object key (uppercase typography turns `bust` into **BUST**).
- **Data:** use `chest ?? bust` for numeric display and filters; `getModelData` exposes `measurements.chest` (not `bust`) for client detail views.

## Portfolio images (client / web)

`models.portfolio_images` may contain mixed legacy shapes:

| Shape | Example | Client handling |
|--------|---------|-----------------|
| Canonical | `supabase-storage://documentspictures/model-photos/{modelId}/file.jpg` | Resolve via `StorageImage` → signed URL |
| HTTPS | Public or signed Supabase URL | `StorageImage` / resolver as applicable |
| Relative path | `model-photos/{modelId}/file.jpg` | `normalizeDocumentspicturesModelImageRef` → canonical URI |
| Bare filename | `timestamp-random.jpg` | Normalized to `model-photos/{modelId}/{filename}` (same pattern as upload path) |

**Guest links:** `getGuestLinkModels` signs `documentspictures` paths after the same normalization so anon sessions do not receive unresolvable refs.

## Product invariants

- **Standard discovery:** portfolio only; polaroids stay out of normal discovery grids (packages / guest links use `packageType`).
- **Security:** Normalization does not widen visibility — it only repairs string shape for the same model row. Wrong paths still fail signing under RLS/storage helpers.

## Code references

- `src/utils/normalizeModelPortfolioUrl.ts` — `normalizeDocumentspicturesModelImageRef` (no Supabase import — safe for tests / `apiService.js`)
- `src/storage/storageUrl.ts` — `resolveStorageUrl` / `needsResolution`
- `src/components/StorageImage.tsx` — client rendering
- `src/services/apiService.js` — `getModelData` maps portfolio + measurements
- `src/services/guestLinksSupabase.ts` — `signImageUrls` + model id
