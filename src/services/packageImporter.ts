/**
 * Package Importer — provider-neutral.
 *
 * Nimmt `ProviderImportPayload[]` (vom MediaSlide- oder später Netwalk-Adapter),
 * wendet die einzige produktweite Bildmengen-Regel an (siehe `PACKAGE_IMPORT_LIMITS`),
 * baut daraus Preview-Modelle für die UI und committed via bestehender
 * `importModelAndMerge`-Funktion.
 *
 * KEIN HTTP, KEINE Provider-Spezifika. Reine Mapping-/Orchestrierungs-Schicht.
 *
 * Wichtige Garantien:
 *  - `agency_id` kommt IMMER aus dem `agencyId`-Parameter, NIEMALS aus dem Provider.
 *  - Bildlimits werden hier zentral angewendet und sind transparent (verworfene Anzahl im Preview).
 *  - Bei `forceUpdateMeasurements=false` (Default) wird `importModelAndMerge` mit `false` gerufen
 *    → existierende Maße bleiben erhalten.
 *  - `email` / `birthday` / `sex` / `ethnicity` / `country_code` / `territories` / `user_id`
 *    werden NIEMALS aus Package-Daten gefüllt (siehe Plan §4.3).
 */

import { importModelAndMerge, type ImportModelPayload } from './modelsImportSupabase';
import {
  PACKAGE_IMPORT_LIMITS,
  type CommitOptions,
  type CommitOutcome,
  type CommitProgress,
  type CommitSummary,
  type PreviewModel,
  type ProviderImportPayload,
} from './packageImportTypes';
import { imageDedupKey } from './mediaslidePackageParser';

/**
 * Wandelt rohe Provider-Payloads in für die UI sichtbare Preview-Modelle um.
 * Wendet zentral Dedup + Bildlimit an. Markiert Models ohne `externalId` oder `name` als skipped.
 */
export function toPreviewModels(payloads: ProviderImportPayload[]): PreviewModel[] {
  return payloads.map((p) => buildPreview(p));
}

function buildPreview(p: ProviderImportPayload): PreviewModel {
  const warnings: string[] = [...(p.warnings ?? [])];

  if (!p.externalId || !p.externalId.trim()) {
    return {
      externalProvider: p.externalProvider,
      externalId: p.externalId ?? '',
      name: p.name ?? '',
      coverImageUrl: p.coverImageUrl ?? null,
      status: 'skipped',
      skipReason: 'missing_external_id',
      measurements: p.measurements,
      portfolio_image_urls: [],
      polaroid_image_urls: [],
      discardedPortfolio: 0,
      discardedPolaroids: 0,
      warnings,
    };
  }
  if (!p.name || !p.name.trim()) {
    return {
      externalProvider: p.externalProvider,
      externalId: p.externalId,
      name: '',
      coverImageUrl: p.coverImageUrl ?? null,
      status: 'skipped',
      skipReason: 'missing_name',
      measurements: p.measurements,
      portfolio_image_urls: [],
      polaroid_image_urls: [],
      discardedPortfolio: 0,
      discardedPolaroids: 0,
      warnings,
    };
  }
  if (p.measurements?.height == null) {
    // height ist Pflicht im Ziel-Schema (`models.height NOT NULL`) — wir markieren als skipped,
    // damit die Agency den Eintrag nicht stillschweigend kaputt importiert.
    return {
      externalProvider: p.externalProvider,
      externalId: p.externalId,
      name: p.name,
      coverImageUrl: p.coverImageUrl ?? null,
      status: 'skipped',
      skipReason: 'missing_height',
      measurements: p.measurements,
      hair_color_raw: p.hair_color_raw,
      eye_color_raw: p.eye_color_raw,
      instagram: p.instagram,
      portfolio_image_urls: [],
      polaroid_image_urls: [],
      discardedPortfolio: 0,
      discardedPolaroids: 0,
      extra_album_counts: p.extra_album_counts,
      warnings,
    };
  }

  const portfolioDeduped = dedupKeepOrder(p.portfolio_image_urls);
  const polaroidsDeduped = dedupKeepOrder(p.polaroid_image_urls);

  const portfolio = portfolioDeduped.slice(0, PACKAGE_IMPORT_LIMITS.MAX_PORTFOLIO_IMAGES_PER_MODEL);
  const polaroids = polaroidsDeduped.slice(0, PACKAGE_IMPORT_LIMITS.MAX_POLAROIDS_PER_MODEL);

  const discardedPortfolio = portfolioDeduped.length - portfolio.length;
  const discardedPolaroids = polaroidsDeduped.length - polaroids.length;

  return {
    externalProvider: p.externalProvider,
    externalId: p.externalId,
    name: p.name,
    coverImageUrl: p.coverImageUrl ?? null,
    status: 'ready',
    measurements: p.measurements,
    hair_color_raw: p.hair_color_raw,
    eye_color_raw: p.eye_color_raw,
    instagram: p.instagram,
    portfolio_image_urls: portfolio,
    polaroid_image_urls: polaroids,
    discardedPortfolio,
    discardedPolaroids,
    extra_album_counts: p.extra_album_counts,
    warnings,
  };
}

function dedupKeepOrder(urls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    if (typeof u !== 'string' || !u.trim()) continue;
    const key = imageDedupKey(u);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

/**
 * Mappt ein einzelnes ready-Preview-Model auf den ImportModelPayload des bestehenden Importers.
 * `agencyId` ist Pflicht; nur die in §4.1 / §4.2 freigegebenen Felder werden gesetzt.
 */
export function previewToImportPayload(input: {
  preview: PreviewModel;
  agencyId: string;
  options: CommitOptions;
}): ImportModelPayload {
  const { preview, agencyId, options } = input;
  if (preview.status !== 'ready') {
    throw new Error(`previewToImportPayload: status must be 'ready', got ${preview.status}`);
  }
  if (preview.measurements.height == null) {
    throw new Error('previewToImportPayload: height is required');
  }

  return {
    mediaslide_sync_id: preview.externalProvider === 'mediaslide' ? preview.externalId : undefined,
    netwalk_model_id: preview.externalProvider === 'netwalk' ? preview.externalId : undefined,
    name: preview.name,
    agency_id: agencyId,
    height: preview.measurements.height,
    bust: preview.measurements.bust ?? null,
    waist: preview.measurements.waist ?? null,
    hips: preview.measurements.hips ?? null,
    chest: preview.measurements.chest ?? null,
    legs_inseam: preview.measurements.legs_inseam ?? null,
    shoe_size: preview.measurements.shoe_size ?? null,
    hair_color: preview.hair_color_raw ?? null,
    eye_color: preview.eye_color_raw ?? null,
    portfolio_images: preview.portfolio_image_urls,
    polaroids: preview.polaroid_image_urls,
    forceUpdateMeasurements: options.forceUpdateMeasurements ?? false,
  };
}

/**
 * Sequentieller Commit-Lauf: pro Model `importModelAndMerge`. Robust gegen Teilfehler.
 * Cancel via AbortSignal stoppt VOR dem nächsten Model (kein Mid-Model-Rollback).
 */
export async function commitPreview(input: {
  selected: PreviewModel[];
  agencyId: string;
  options: CommitOptions;
  signal?: AbortSignal;
  onProgress?: (p: CommitProgress) => void;
  /** Test-Hook: ersetze den tatsächlichen Importer-Aufruf. */
  importImpl?: typeof importModelAndMerge;
}): Promise<CommitSummary> {
  const importer = input.importImpl ?? importModelAndMerge;
  const total = input.selected.length;
  const outcomes: CommitOutcome[] = [];
  let createdCount = 0;
  let mergedCount = 0;
  let warningCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < total; i++) {
    if (input.signal?.aborted) {
      // Restliche Models nicht mehr antasten — als skipped notieren.
      for (let j = i; j < total; j++) {
        const remaining = input.selected[j];
        outcomes.push({
          externalId: remaining.externalId,
          name: remaining.name,
          status: 'skipped',
          reason: 'cancelled_by_user',
        });
        skippedCount++;
      }
      break;
    }

    const preview = input.selected[i];
    input.onProgress?.({ total, done: i, currentLabel: preview.name });

    if (preview.status !== 'ready') {
      outcomes.push({
        externalId: preview.externalId,
        name: preview.name,
        status: 'skipped',
        reason: preview.skipReason ?? 'not_ready',
      });
      skippedCount++;
      continue;
    }

    let payload: ImportModelPayload;
    try {
      payload = previewToImportPayload({
        preview,
        agencyId: input.agencyId,
        options: input.options,
      });
    } catch (e) {
      outcomes.push({
        externalId: preview.externalId,
        name: preview.name,
        status: 'error',
        reason: `payload_build_failed:${(e as Error).message ?? 'unknown'}`,
      });
      errorCount++;
      continue;
    }

    try {
      const res = await importer(payload);
      if (!res) {
        outcomes.push({
          externalId: preview.externalId,
          name: preview.name,
          status: 'error',
          reason: 'import_returned_null',
        });
        errorCount++;
        continue;
      }
      if (res.externalSyncIdsPersistFailed) {
        outcomes.push({
          externalId: preview.externalId,
          name: preview.name,
          status: 'warning',
          modelId: res.model_id,
          reason: 'external_sync_ids_persist_failed',
        });
        warningCount++;
        continue;
      }
      if (res.created) {
        outcomes.push({
          externalId: preview.externalId,
          name: preview.name,
          status: 'created',
          modelId: res.model_id,
        });
        createdCount++;
      } else {
        outcomes.push({
          externalId: preview.externalId,
          name: preview.name,
          status: 'merged',
          modelId: res.model_id,
        });
        mergedCount++;
      }
    } catch (e) {
      outcomes.push({
        externalId: preview.externalId,
        name: preview.name,
        status: 'error',
        reason: `import_threw:${(e as Error).message ?? 'unknown'}`,
      });
      errorCount++;
    }
  }

  input.onProgress?.({ total, done: total });

  return {
    outcomes,
    createdCount,
    mergedCount,
    warningCount,
    errorCount,
    skippedCount,
  };
}

export { PACKAGE_IMPORT_LIMITS };
