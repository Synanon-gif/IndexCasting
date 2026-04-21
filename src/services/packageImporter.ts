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
import { imageDedupKey } from './imageDedupKey';
import {
  classifyImagePersistResult,
  persistImagesForPackageImport,
  type PackageImageProgress,
  type PackageImagePersistResult,
  type PersistImagesForModelInput,
} from './packageImagePersistence';

/**
 * Wandelt rohe Provider-Payloads in für die UI sichtbare Preview-Modelle um.
 * Wendet zentral Dedup + Bildlimit an. Markiert Models ohne `externalId` oder `name` als skipped.
 *
 * Zusatz-Schutz: wenn der Provider versehentlich zwei Karten mit derselben `externalId`
 * liefert (kaputtes List-HTML, doppelte `data-model-id`), markieren wir beide Previews mit
 * einer expliziten `duplicate_external_id`-Warnung. Wir mergen NICHT still — die Agency
 * sieht beide Zeilen und entscheidet bewusst. Der DB-Merge via `mediaslide_sync_id` würde
 * sonst stillschweigend passieren und unsere Preview-Pflicht aushebeln.
 */
export function toPreviewModels(payloads: ProviderImportPayload[]): PreviewModel[] {
  const seen = new Map<string, number>();
  for (const p of payloads) {
    const id = (p.externalId ?? '').trim();
    if (!id) continue;
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  return payloads.map((p) => {
    const preview = buildPreview(p);
    const id = (p.externalId ?? '').trim();
    if (id && (seen.get(id) ?? 0) > 1) {
      preview.warnings = [...preview.warnings, `duplicate_external_id:${id}`];
    }
    return preview;
  });
}

function buildPreview(p: ProviderImportPayload): PreviewModel {
  const warnings: string[] = [...(p.warnings ?? [])];

  // Provider-Override: wenn der Adapter den Payload ausdrücklich als unvollständig
  // markiert (z. B. Book-Fetch komplett fehlgeschlagen), niemals als ready zulassen.
  if (p.forceSkipReason && p.externalId && p.externalId.trim()) {
    return {
      externalProvider: p.externalProvider,
      externalId: p.externalId,
      name: p.name ?? '',
      coverImageUrl: p.coverImageUrl ?? null,
      status: 'skipped',
      skipReason: p.forceSkipReason,
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

  // "Empty-Ready"-Schutz: ein Model ohne ein einziges verwertbares Bild ist für die
  // Agency wertlos und ein klassisches Zeichen für ein halb gerendertes Book oder
  // einen Drift-Edge-Case. Wir markieren ausdrücklich als skipped, statt einen
  // bildlosen Datensatz still in die DB zu schreiben.
  if (portfolio.length === 0 && polaroids.length === 0) {
    return {
      externalProvider: p.externalProvider,
      externalId: p.externalId,
      name: p.name,
      coverImageUrl: p.coverImageUrl ?? null,
      status: 'skipped',
      skipReason: 'no_images',
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

  // photo_source spiegelt die Herkunft der Bilder wider — bei Package-Imports
  // immer der externe Provider. Der Importer setzt das Feld bei INSERT direkt;
  // bei UPDATE eines bestehenden 'own'-Models wird via RPC nachgezogen.
  //
  // Exhaustive-Switch: jeder neue PackageProviderId-Wert MUSS hier ergänzt werden,
  // sonst schlägt der TypeScript-Build fehl (`never`-Branch). Damit kann ein neuer
  // Provider niemals still ohne photo_source committen.
  const photoSource: 'mediaslide' | 'netwalk' = (() => {
    switch (preview.externalProvider) {
      case 'mediaslide':
        return 'mediaslide';
      case 'netwalk':
        return 'netwalk';
      default: {
        const _exhaustive: never = preview.externalProvider;
        throw new Error(
          `previewToImportPayload: unknown externalProvider ${String(_exhaustive)} — refusing to commit without photo_source`,
        );
      }
    }
  })();

  // Re-Import-Key strikt provider-spezifisch — nur EIN Sync-Slot pro Payload.
  // Wir setzen den Slot, der zum Provider gehört, und lassen den anderen explizit
  // undefined. So merget der Importer NIE über einen falschen Slot.
  const mediaslideSyncId: string | undefined =
    preview.externalProvider === 'mediaslide' ? preview.externalId : undefined;
  const netwalkModelId: string | undefined =
    preview.externalProvider === 'netwalk' ? preview.externalId : undefined;

  return {
    mediaslide_sync_id: mediaslideSyncId,
    netwalk_model_id: netwalkModelId,
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
    photo_source: photoSource,
  };
}

/**
 * Sequentieller Commit-Lauf: pro Model `importModelAndMerge`. Robust gegen Teilfehler.
 * Cancel via AbortSignal stoppt VOR dem nächsten Model (kein Mid-Model-Rollback).
 *
 * Bild-Persistenz (Phase 2):
 *  - Wenn `options.persistImages === true` (UI-Default), werden die externen
 *    Bild-URLs NICHT in `models.portfolio_images` / `models.polaroids`
 *    geschrieben. Stattdessen läuft nach dem `importModelAndMerge`-Erfolg
 *    `persistImagesForPackageImport`, das die Bilder herunterlädt, validiert,
 *    in Storage hochlädt und `model_photos`-Zeilen anlegt. Mirror-Spalten
 *    werden anschließend aus `model_photos` neu aufgebaut. Damit ist das
 *    Model unabhängig vom externen Provider, sobald der Commit durch ist.
 *  - `persistImages === false` (Test-/Legacy-Default) erhält das ursprüngliche
 *    Verhalten (externe URLs landen in den Mirror-Spalten). Wird nur in
 *    Tests verwendet, die das Persistenz-Modul nicht doppelt mocken wollen.
 */
export async function commitPreview(input: {
  selected: PreviewModel[];
  agencyId: string;
  options: CommitOptions;
  signal?: AbortSignal;
  onProgress?: (p: CommitProgress) => void;
  /** Test-Hook: ersetze den tatsächlichen Importer-Aufruf. */
  importImpl?: typeof importModelAndMerge;
  /** Test-Hook: ersetze die Bild-Persistenz (sonst {@link persistImagesForPackageImport}). */
  persistImagesImpl?: (input: PersistImagesForModelInput) => Promise<PackageImagePersistResult>;
  /**
   * Optionaler `fetch`-Override für die Phase-2-Bild-Downloads.
   * Wird auf Web genutzt, um Provider-CDNs (z. B. MediaSlide-GCS-Bucket)
   * über die Edge Function `package-image-proxy` zu tunneln, weil diese
   * CDNs keinen `Access-Control-Allow-Origin`-Header senden und ein
   * Direkt-Fetch sonst mit `download_network` (CORS) scheitert.
   * Auf Native bleibt es `undefined` → klassischer `fetch`.
   */
  imageFetchImpl?: typeof fetch;
}): Promise<CommitSummary> {
  const importer = input.importImpl ?? importModelAndMerge;
  const persistImpl = input.persistImagesImpl ?? persistImagesForPackageImport;
  const persistImages = input.options.persistImages === true;
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

    // Wenn Bild-Persistenz aktiv ist: externe URLs NICHT an den DB-Importer
    // weiterreichen. So können beim Merge keine externen Provider-URLs in
    // die Mirror-Spalten leaken. Bei NEW-Insert wird `[]` geschrieben und
    // anschließend durch den Mirror-Rebuild aus `model_photos` befüllt.
    const importerPayload: ImportModelPayload = persistImages
      ? { ...payload, portfolio_images: null, polaroids: null }
      : payload;

    try {
      const res = await importer(importerPayload);
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
      // Default: Status aus dem reinen DB-Schritt (created vs. merged).
      // Bild-Persistenz kann das anschließend zu 'warning' eskalieren.
      const baseStatus: 'created' | 'merged' = res.created ? 'created' : 'merged';
      if (res.created) createdCount++;
      else mergedCount++;

      const baseOutcome: CommitOutcome = {
        externalId: preview.externalId,
        name: preview.name,
        status: baseStatus,
        modelId: res.model_id,
      };

      // Stille Sync-ID-Persistenz-Fehler werden als Warnung markiert,
      // ohne den Bild-Persistenz-Schritt zu überspringen — die DB-Row
      // ist da, die Bilder können trotzdem korrekt gespiegelt werden.
      if (res.externalSyncIdsPersistFailed) {
        baseOutcome.status = 'warning';
        baseOutcome.reason = 'external_sync_ids_persist_failed';
        // Status-Counter umsortieren: created/merged wieder runter,
        // warning rauf.
        if (res.created) createdCount--;
        else mergedCount--;
        warningCount++;
      }

      // Bild-Persistenz (Phase 2). Läuft nur wenn aktiviert UND der DB-Step
      // erfolgreich war. Cancel zwischen Models wird respektiert; innerhalb
      // eines Models wird nicht mehr abgebrochen (kein Mid-Model-Rollback).
      if (persistImages) {
        try {
          const persistRes = await persistImpl({
            modelId: res.model_id,
            provider: preview.externalProvider,
            providerExternalId: preview.externalId,
            portfolioUrls: preview.portfolio_image_urls,
            polaroidUrls: preview.polaroid_image_urls,
            options: {
              signal: input.signal,
              ...(input.imageFetchImpl ? { fetchImpl: input.imageFetchImpl } : {}),
              onImageProgress: (img: PackageImageProgress) =>
                input.onProgress?.({
                  total,
                  done: i,
                  currentLabel: `${preview.name} – ${img.type} ${img.index + 1}`,
                }),
            },
          });
          baseOutcome.imagesPersisted =
            persistRes.portfolioPersisted + persistRes.polaroidPersisted;
          baseOutcome.imagesAttempted =
            persistRes.portfolioAttempted + persistRes.polaroidAttempted;
          baseOutcome.imageFailureReasons = persistRes.failures.map(
            (f) => `${f.type}#${f.index}:${f.reason}`,
          );

          const klass = classifyImagePersistResult(persistRes);
          // Eskalation: jede unvollständige Persistenz ist mindestens
          // 'warning'. Wir downgraden NICHT von 'error' (Sync-IDs +
          // Bild-Fehler bleiben sichtbar getrennt).
          if (
            klass === 'all_failed' &&
            persistRes.portfolioAttempted + persistRes.polaroidAttempted > 0
          ) {
            if (baseOutcome.status === 'created' || baseOutcome.status === 'merged') {
              if (baseOutcome.status === 'created') createdCount--;
              else mergedCount--;
              warningCount++;
            }
            baseOutcome.status = 'warning';
            baseOutcome.reason =
              baseOutcome.reason && baseOutcome.reason !== 'external_sync_ids_persist_failed'
                ? `${baseOutcome.reason};all_images_persistence_failed`
                : 'all_images_persistence_failed';
          } else if (klass === 'partial') {
            if (baseOutcome.status === 'created' || baseOutcome.status === 'merged') {
              if (baseOutcome.status === 'created') createdCount--;
              else mergedCount--;
              warningCount++;
            }
            baseOutcome.status = 'warning';
            const partialReason = `images_partial:${persistRes.portfolioPersisted + persistRes.polaroidPersisted}/${persistRes.portfolioAttempted + persistRes.polaroidAttempted}`;
            baseOutcome.reason = baseOutcome.reason
              ? `${baseOutcome.reason};${partialReason}`
              : partialReason;
          }

          if (!persistRes.mirrorRebuilt) {
            // Sehr seltener Fall: model_photos-Rows existieren, Mirror-
            // Rebuild ist gestolpert. Mache das sichtbar — manuelle
            // Wiederherstellung über Drift-Cleanup nötig.
            if (baseOutcome.status === 'created' || baseOutcome.status === 'merged') {
              if (baseOutcome.status === 'created') createdCount--;
              else mergedCount--;
              warningCount++;
            }
            baseOutcome.status = 'warning';
            const rebuildReason = 'mirror_rebuild_failed';
            baseOutcome.reason = baseOutcome.reason
              ? `${baseOutcome.reason};${rebuildReason}`
              : rebuildReason;
          }
        } catch (persistErr) {
          // Persistenz-Funktion selbst hat geworfen (sollte nicht passieren —
          // sie fängt intern alles ab). Defensive Behandlung: als Warnung
          // markieren, Model bleibt importiert.
          if (baseOutcome.status === 'created' || baseOutcome.status === 'merged') {
            if (baseOutcome.status === 'created') createdCount--;
            else mergedCount--;
            warningCount++;
          }
          baseOutcome.status = 'warning';
          baseOutcome.reason = `image_persistence_threw:${(persistErr as Error).message ?? 'unknown'}`;
        }
      }

      outcomes.push(baseOutcome);
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
