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

### Image persistence — Phase 1 vs Phase 2 (decision matrix)

| Aspect | Phase 1 (current, external URLs) | Phase 2 (future, mirror) |
| --- | --- | --- |
| Where pixels live | `mediaslide-europe.storage.googleapis.com/...` | `documentspictures` bucket via `uploadModelPhoto` |
| Time-to-import | Seconds (no file copy) | Minutes (depends on image count + bandwidth) |
| Storage cost | 0 (external) | Per-agency quota |
| Robustness if package deleted | Images can disappear | Independent copy, agency-owned |
| Offline resilience | Requires upstream availability | Fully self-contained |
| Consent + audit | Same as upstream package | Explicit per-asset consent + storage audit log |
| Implementation effort | Done | Background mirror job, dedup by content hash, retry/backoff, quota checks |

**Phase 1 trade-off accepted:** External URLs are good enough for the agency’s
preview-and-merge use case (Phase 1 success metric: import correctness, not asset
ownership). The UI shows an explicit hint so no one assumes mirroring. The
`photo_source` column (`mediaslide` / `netwalk`) records the origin; this is the
hook Phase 2 will use to decide which models to mirror in the background.

**Phase 2 triggers (any one):**

- Broken-image rate above 5 % within 30 days post-import.
- Agency explicitly requests "owned media".
- A package URL becomes 404 within the first 90 days.
- Auditor flags external dependency as a compliance issue.

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

### Drift detection (Phase 1 hardening)

A separate, provider-agnostic helper [`src/services/providerDriftDetector.ts`](../src/services/providerDriftDetector.ts)
evaluates every analyze run against a set of expected layout signals. Result:

```
DriftResult {
  severity: 'ok' | 'soft_warn' | 'hard_block',
  parserVersion, providerId, maskedUrl,
  anchorCoverage, missingAnchors,
  extractionRatio, bookOkRatio, reasonCodes,
  cardsDetected, cardsExtracted,
}
```

- **Hard block** (`anchor coverage < 70 %`, `extraction ratio < 50 %`, or
  `book-OK ratio < 60 %`): the provider throws a `ParserDriftError`. The UI moves
  to phase `drift_blocked`, shows a structured banner with masked URL +
  reason codes, and offers an explicit override flow that requires typing the
  literal word `OVERRIDE`. Even after override, `importModelAndMerge`'s
  pre-existing safety checks continue to apply (`missing_external_id`,
  `missing_name`, `missing_height`, `no_images`, `forceSkipReason`) — so the
  database is never written into a corrupt state.
- **Soft warn** (only some non-critical anchors missing): the analyze succeeds
  and the UI keeps the drift banner visible above the preview list as a heads-up.
- All drift events are `console.warn`-logged with the full structured payload
  for centralised log scraping; URLs are masked (host + first path segment only).

The expected anchors and parser version are owned by the provider. For
MediaSlide they live next to the parser as `MEDIASLIDE_LIST_ANCHORS` and
`MEDIASLIDE_PARSER_VERSION`.

### Provider registry + Netwalk skeleton

Provider lookup is centralised in [`src/services/providerRegistry.ts`](../src/services/providerRegistry.ts).
The UI never references a concrete provider; it calls `getProviderForUrl(url)`
and uses whatever the registry returns. Adding Netwalk later is now a
single-file change.

A stub [`src/services/netwalkPackageProvider.ts`](../src/services/netwalkPackageProvider.ts)
already implements `detect()` for `netwalk.eu`, `netwalk.app`, and
`netwalkapp.com` hosts. Its `analyze()` throws `netwalk_provider_not_implemented`,
which the UI humanises as "Netwalk-Import ist noch nicht freigeschaltet
(Phase 2)". This means a netwalk URL will never silently be misrouted to the
MediaSlide parser.

**Current research status (April 2026):** Netwalk's package HTML and
sample URLs have not yet been captured against a real account. Until at least
two real package samples are available we cannot land a parser without
risking the same drift class that the detector now guards against. The
skeleton + registry slot let us add the parser without touching the importer
or UI.

## Related rules

- Upload consent matrix: [.cursor/rules/upload-consent-matrix.mdc](../.cursor/rules/upload-consent-matrix.mdc).
- Model creation entry points: [`src/services/modelCreationFacade.ts`](../src/services/modelCreationFacade.ts).
