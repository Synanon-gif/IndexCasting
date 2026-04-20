# Package Import — Invariants & Smoke-Test Matrix

This document is the human-readable companion to the always-on rule
[`.cursor/rules/package-import-invariants.mdc`](../.cursor/rules/package-import-invariants.mdc).
It lists what the agency-driven package import (`MediaSlide today, Netwalk tomorrow`)
**guarantees**, what it **blocks**, what it **skips**, and what an admin **may** override.

For the engineering deep-dive on the layered architecture (fetcher → parser →
provider → importer → UI) see [`MEDIASLIDE_NETWALK_SYNC.md`](./MEDIASLIDE_NETWALK_SYNC.md).

---

## 1. Hard guarantees (every package import, every provider)

| # | Guarantee | Where it is enforced |
| --- | --- | --- |
| 1 | A package is **previewed** before any DB write. | `PackageImportPane.tsx` state machine (`idle → analyzing → previewing → committing → done`). |
| 2 | `agency_id` always comes from the caller, never from provider data. | `packageImporter.previewToImportPayload`, RLS contract of `importModelAndMerge`. |
| 3 | `photo_source` is set explicitly per provider (`mediaslide` / `netwalk`). | `previewToImportPayload` — exhaustive switch with `never`-fallback. |
| 4 | Sync IDs are mapped 1:1 to provider columns (`mediaslide_sync_id` xor `netwalk_model_id`). | `previewToImportPayload`. |
| 5 | Re-imports are idempotent — same `externalId` updates, never duplicates. | `importModelAndMerge` lookup in `modelsImportSupabase.ts`. |
| 6 | Hard image caps (Portfolio 20 / Polaroids 10) are applied centrally. | `PACKAGE_IMPORT_LIMITS` + `packageImporter.buildPreview`. |
| 7 | DOM image order is preserved through dedup and capping. | `imageDedupKey` + ordered slice in `buildPreview`. |
| 8 | Models without usable images are skipped with `no_images`, never marked `ready`. | `buildPreview` skip pipeline. |
| 9 | `ProviderImportPayload` cannot inject sensitive fields (`id`, `auth_user_id`, `agency_id`, `email`, `password`). | Type definition does not declare them; importer ignores anything else. |
| 10 | Drift signals (`anchorCoverage`, `extractionRatio`, `bookOkRatio`) are evaluated per analyze run. | `providerDriftDetector.evaluateRunDrift`. |

## 2. What is blocked (hard, no override)

- A package URL that does not match any registered provider — the UI shows
  `unsupported_provider_url` and never falls through to a different provider.
- A provider whose `analyze()` is not implemented (currently Netwalk).
  `netwalkPackageProvider.analyze()` throws `netwalk_provider_not_implemented`.
- Drift `hard_block` (anchor coverage < 70 %, extraction < 50 %, or book-OK < 60 %)
  → `ParserDriftError`, UI moves to `drift_blocked`.

## 3. What is skipped (data quality safety net)

A model is dropped from the commit (visible in the preview as a `skip` row with reason):

- `missing_external_id` — provider returned a card without a stable identifier.
- `missing_name` — name parsing failed.
- `missing_height` — height is missing **and** there is no fallback in the book.
- `no_images` — both portfolio and polaroid lists are empty after dedup.
- `forced:<reason>` — provider explicitly set `forceSkipReason` (e.g. `book_fetch_failed`).

Skips are NEVER replaced by fake data, and the importer NEVER overrides
`forceSkipReason` from the provider.

## 4. What can be overridden (admin only, scoped)

| Override | What it allows | What it does NOT allow |
| --- | --- | --- |
| `allowDriftBypass: true` (admin types `OVERRIDE` in UI) | Render the preview and let the agency commit a run that would otherwise be blocked by the drift detector. | Bypass the per-model skip safety net (`missing_*`, `no_images`, `forceSkipReason`) — those still apply. The drift banner stays visible above the preview list. |
| `forceUpdateMeasurements: true` (commit option) | Overwrite measurement fields on an existing model match. | Overwrite `agency_id`, `auth_user_id`, `email_login`, `password`, or any provider-injected sensitive field. |

## 5. Drift signals & log hygiene

- Every analyze run logs a structured `drift` payload (`severity`, `parserVersion`,
  `providerId`, `maskedUrl`, `anchorCoverage`, `extractionRatio`, `bookOkRatio`,
  `reasonCodes`, `cardsDetected`, `cardsExtracted`).
- URLs are masked with `maskUrl(...)` before logging — only the host and the first
  path segment leak; capability hashes are redacted.
- Soft warns (some non-critical anchors missing) keep the banner visible above
  the preview list without blocking the commit.

## 6. Netwalk readiness

The Netwalk slot exists end-to-end (registry, photo_source, importer mapping,
UI reason code, drift detector, contract test) but the parser intentionally
does not exist yet. See [`MEDIASLIDE_NETWALK_SYNC.md` → "Netwalk readiness — current status"](./MEDIASLIDE_NETWALK_SYNC.md#netwalk-readiness--current-status).

The same invariants in this document apply identically to Netwalk once the
parser ships — adding Netwalk MUST NOT require relaxing any of the above.

## 7. Smoke-test matrix

Detailed perspective table lives in
[`MEDIASLIDE_NETWALK_SYNC.md` → "Hardening smoke-test matrix"](./MEDIASLIDE_NETWALK_SYNC.md#hardening-smoke-test-matrix-april-2026).

Short version:

- Parser → `mediaslidePackageParser.test.ts`
- Provider (real + adversarial) → `mediaslidePackageProvider.test.ts`, `mediaslidePackageProvider.smoke.test.ts`
- Importer (mapping + caps + skips + drift override) → `packageImporter.test.ts`, `packageImporter.smoke.test.ts`
- Drift detector → `providerDriftDetector.test.ts`
- Provider contract / registry / Netwalk stub → `packageProviderContract.test.ts`
- UI state machine → `packageImportPane.logic.test.ts`

These tests are **part of the invariant** — removing or weakening them without
equivalent replacement is a release blocker (see rule §G).
