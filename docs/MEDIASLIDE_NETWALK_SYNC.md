# Mediaslide & Netwalk sync — engineering notes

## What the code does today

- **Connectors:** [`src/services/mediaslideConnector.js`](src/services/mediaslideConnector.js) and [`src/services/netwalkConnector.js`](src/services/netwalkConnector.js) call external HTTP APIs when `EXPO_PUBLIC_MEDIASLIDE_API_URL` / the Netwalk equivalent is set; otherwise they run in **mock mode** (local DB reads only for Mediaslide mock).
- **Sync services:** [`src/services/mediaslideSyncService.ts`](src/services/mediaslideSyncService.ts) and [`src/services/netwalkSyncService.ts`](src/services/netwalkSyncService.ts) map remote **measurements and profile fields** into `public.models`, then persist external IDs via the SECURITY DEFINER RPC **`update_model_sync_ids`** (columns `mediaslide_sync_id`, `netwalk_model_id` are revoked for direct client `UPDATE`).
- **Territories:** After a successful model update, sync may call territory RPCs so `model_agency_territories` stays aligned with the integration.

## Images / portfolio — no automatic mirror into Supabase Storage

- Sync updates **`models.portfolio_images`** and **`models.polaroids`** (and related visibility flags) from whatever the remote API returns — typically **URLs pointing at Mediaslide/Netwalk or CDN**, not files uploaded to our `documentspictures` bucket.
- **First-party portfolio uploads** (agency/model UI) use [`src/services/modelPhotosSupabase.ts`](src/services/modelPhotosSupabase.ts) and store objects in **`documentspictures`** with `model_photos` rows.
- Therefore: **integrations do not, by themselves, eliminate “double maintenance”** if product requires all pixels to live in our bucket. That would need an explicit **import/mirror** job (fetch URL → `uploadModelPhoto` / internal pipeline) with consent, rate limits, and deduplication — out of scope of the current connector layer.

## Operational checklist

1. **API base URL + keys** configured for production; mock mode is dev-only.
2. **Cron / webhook** (`runMediaslideCronSync`, `runNetwalkCronSync`, webhooks) must match expected load; failures go to `mediaslide_sync_logs`.
3. **DB guards:** `update_model_sync_ids` requires caller in agency via `organization_members` + `organizations.type = 'agency'` or legacy `bookers` (see migration `20260407_fix_update_model_sync_ids_no_owner_user_id.sql`).

## Package Import (Phase 1 — Agency self-service)

A second, **agency-driven** ingestion path lives next to the cron/webhook sync above:
the **MediaSlide Package Import**. It lets an agency paste a `.../package/view/...` link
and stage up to 50 models for review before any DB write happens.

### Layered architecture

| Layer | File | Responsibility |
| --- | --- | --- |
| Provider-neutral types | [`src/services/packageImportTypes.ts`](../src/services/packageImportTypes.ts) | `ProviderImportPayload`, `PreviewModel`, `CommitSummary`, hard image caps. |
| HTTP transport | [`src/services/mediaslidePackageFetcher.ts`](../src/services/mediaslidePackageFetcher.ts) | Cookie jar (PHPSESSID), 10 s timeout, 2× retry, capability-hash redaction in logs. |
| DOM parser (pure) | [`src/services/mediaslidePackageParser.ts`](../src/services/mediaslidePackageParser.ts) | Stable extraction via `data-model-id`, `translate="no"`, `.measurementElement`, GCS URL pattern. |
| MediaSlide adapter | [`src/services/mediaslidePackageProvider.ts`](../src/services/mediaslidePackageProvider.ts) | Combines fetcher + parser; classifies albums into PORTFOLIO / POLAROIDS / extra. |
| Generic importer | [`src/services/packageImporter.ts`](../src/services/packageImporter.ts) | Provider-neutral: dedup, hard image caps, mapping → `importModelAndMerge`, partial-failure summary. |
| Agency UI | [`src/components/PackageImportPane.tsx`](../src/components/PackageImportPane.tsx) | Multi-step state machine `idle → analyzing → previewing → committing → done`. |

### Image persistence — Phase 1 vs Phase 2

- **Phase 1 (current):** Imported `portfolio_images` / `polaroids` are stored as **external
  GCS URLs** (`mediaslide-europe.storage.googleapis.com/...`). The Agency UI explicitly
  warns about this so nobody assumes the images are mirrored. Same invariant as the existing
  cron/webhook sync (see “Images / portfolio — no automatic mirror” above).
- **Phase 2 (future, opt-in):** A background job will copy URLs into `documentspictures`
  via `uploadModelPhoto`, with consent confirmation, dedup by content hash, retry/backoff,
  and per-agency storage quota checks. Out of scope for Phase 1.

### Hard image caps (product rule)

Defined once in `PACKAGE_IMPORT_LIMITS` and applied **only** in `packageImporter.ts`
(provider/parser stay dumb):

- `MAX_PORTFOLIO_IMAGES_PER_MODEL = 20`
- `MAX_POLAROIDS_PER_MODEL = 10`
- `SOFT_MODELS_PER_RUN = 60`, `MAX_MODELS_PER_RUN = 100`

Discarded counts surface in the preview row so the agency sees exactly what was dropped.

### Security & invariants preserved

- `agency_id` always comes from the caller (UI passes `currentAgencyId`); never from the
  package payload — same RLS contract as `importModelAndMerge`.
- External sync IDs (`mediaslide_sync_id`, `netwalk_model_id`) continue to flow through
  the SECURITY DEFINER RPC `update_model_sync_ids` inside `importModelAndMerge`.
- Sensitive fields (`email`, `birthday`, `sex`, `ethnicity`, `country_code`, `territories`,
  `user_id`) are **never** populated from package data — the importer test enforces this.
- Capability hashes in package URLs are redacted in logs (`/REDACTED` segments).

### Netwalk reuse later

Only the three MediaSlide-specific files (`mediaslidePackage{Fetcher,Parser,Provider}.ts`)
are provider-bound. To add Netwalk we add a `netwalkPackageProvider.ts` that emits the
same `ProviderImportPayload`; the importer, types, and UI stay unchanged.

## Related rules

- Upload consent matrix: [.cursor/rules/upload-consent-matrix.mdc](../.cursor/rules/upload-consent-matrix.mdc).
- Model creation entry points: [`src/services/modelCreationFacade.ts`](../src/services/modelCreationFacade.ts).
