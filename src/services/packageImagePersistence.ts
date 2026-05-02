/**
 * Package Image Persistence — provider-neutral image mirror flow.
 *
 * Lädt externe Provider-Bild-URLs (MediaSlide, später Netwalk) kontrolliert
 * herunter und persistiert sie in unseren Storage / `model_photos`. Damit ist
 * das importierte Model unabhängig vom externen Package — wenn MediaSlide
 * URLs ändert, das Package deaktiviert oder Bilder entfernt, bleiben die
 * persistierten Bilder bei uns.
 *
 * Pipeline pro Bild:
 *  1. Kontrollierter Download (timeout, redirect-follow, content-length cap).
 *  2. Validierung der Response (status, content-type, non-empty body).
 *  3. Konvertierung in `File` mit deterministischem Namen.
 *  4. Upload via `uploadModelPhoto({ skipConsentCheck: true })` —
 *     dadurch laufen ALLE bestehenden Sicherheitschecks (MIME whitelist,
 *     magic bytes, extension consistency, EXIF strip, agency storage quota).
 *  5. INSERT `model_photos`-Zeile mit korrektem `photo_type` + `source` +
 *     `api_external_id` (provider externalId), sodass `model_photos`
 *     weiterhin Source-of-Truth nach §27.1 bleibt.
 *
 * Sicherheitsgarantien (siehe `package-import-invariants.mdc`):
 *  - Bilder von Model A landen NIE bei Model B: `modelId` ist ein einziger,
 *    nicht von externen Daten beeinflussbarer Parameter dieser Funktion.
 *  - Portfolio und Polaroids werden in getrennten Persist-Schleifen mit
 *    explizitem `photo_type` verarbeitet und niemals vermischt.
 *  - Reihenfolge bleibt erhalten: Quell-URLs werden in Index-Reihenfolge
 *    persistiert; `model_photos.sort_order` wird durch `addPhoto`
 *    monoton hochgezählt.
 *  - Provider-neutral: keine MediaSlide-spezifischen URL-Patterns oder
 *    DOM-Annahmen. Nimmt nur eine `source`-Markierung pro Provider entgegen.
 *
 * GDPR / Consent:
 *  - Das Pattern `skipConsentCheck: true` ist bewusst gewählt und identisch
 *    zu `migrateModelPhotoBucket` (existierende, gehärtete Promotion-Pipeline
 *    für agency-interne Bilder). Begründung: die Agency hat den
 *    Package-Link aktiv eingefügt — das ist die deklarative Bestätigung,
 *    dass die Agency die Rechte für die per Package geteilten Bilder hat.
 *    Pro persistiertem Bild läuft zusätzlich der Audit-Trail von
 *    `uploadModelPhoto` (`logAction(..., 'uploadModelPhoto', { type: 'image' })`).
 */

import {
  addPhoto,
  deletePhoto,
  rebuildPolaroidsFromModelPhotos,
  rebuildPortfolioImagesFromModelPhotos,
  uploadModelPhoto,
  type ModelPhotoType,
} from './modelPhotosSupabase';
import type { PackageProviderId } from './packageImportTypes';
import { redactPackageUrl } from './mediaslidePackageFetcher';

/** Hard cap pro Einzeldownload — verhindert Storage-Überflutung durch riesige Quell-Bilder. */
export const PACKAGE_IMAGE_DOWNLOAD_LIMIT_BYTES = 25 * 1024 * 1024;

/** Default-Timeout pro Download in ms. Provider-CDNs antworten i. d. R. unter 5s. */
export const PACKAGE_IMAGE_DOWNLOAD_TIMEOUT_MS = 15_000;

/** Erlaubte MIME-Typen für persistierte Package-Bilder (entspricht `uploadModelPhoto`-Whitelist ohne PDF). */
const ALLOWED_DOWNLOAD_CONTENT_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export type PackageImagePersistFailure = {
  /** Position innerhalb der Quell-Liste (Portfolio / Polaroids). */
  index: number;
  /** Album, in dem das Bild fehlgeschlagen ist. */
  type: 'portfolio' | 'polaroid';
  /** Maskierte Quell-URL (kein Token / Capability-Hash). */
  maskedUrl: string;
  /** Maschinenlesbarer Reason-Code. */
  reason: PackageImagePersistFailureReason;
  /** Optionale Detail-Info (HTTP-Status, MIME-Typ, etc.). */
  detail?: string;
};

export type PackageImagePersistFailureReason =
  | 'download_timeout'
  | 'download_http_error'
  | 'download_network'
  | 'download_aborted'
  | 'invalid_content_type'
  | 'empty_response'
  | 'too_large'
  | 'upload_failed'
  | 'addphoto_failed'
  | 'invalid_url'
  | 'duplicate_source_url';

export type PackageImagePersistResult = {
  /** Anzahl erfolgreich persistierter Portfolio-Bilder. */
  portfolioPersisted: number;
  /** Anzahl insgesamt versuchter Portfolio-Bilder (== Eingabe-Länge). */
  portfolioAttempted: number;
  /** Anzahl erfolgreich persistierter Polaroid-Bilder. */
  polaroidPersisted: number;
  /** Anzahl insgesamt versuchter Polaroid-Bilder. */
  polaroidAttempted: number;
  /** Pro fehlgeschlagenem Bild eine Failure-Eintragung (geordnet nach (type, index)). */
  failures: PackageImagePersistFailure[];
  /**
   * Mirror-Spalten von `models` wurden via `model_photos`-Rebuild aktualisiert.
   * `false` bedeutet: Rebuild fehlgeschlagen — ein anderer Verantwortlicher
   * (z. B. Drift-Cleanup) muss aufräumen. Tritt extrem selten auf.
   */
  mirrorRebuilt: boolean;
  /**
   * Anzahl der `model_photos`-Rows desselben Packages, die VOR dem neuen
   * Persist-Lauf abgeräumt wurden (Idempotenz-Garantie für Re-Imports).
   * 0 = kein vorheriger Import dieses Packages für dieses Model existierte.
   */
  previousPackagePhotosCleared: number;
  /**
   * Anzahl der Reihen, deren Cleanup-Versuch fehlschlug. >0 bedeutet:
   * potenzielle Duplikate könnten zurückbleiben — UI sollte das als Warning
   * surfacen. Wir blocken den Re-Import deswegen aber NICHT, sonst bliebe
   * der Agency keine Möglichkeit, einen kaputten Vorzustand zu reparieren.
   */
  previousPackagePhotosClearFailures: number;
};

export type PersistImageOptions = {
  /** Test-Hook: ersetze `fetch` (Downloads gegen Provider-CDN). */
  fetchImpl?: typeof fetch;
  /** Test-Hook: ersetze `uploadModelPhoto`. */
  uploadImpl?: typeof uploadModelPhoto;
  /** Test-Hook: ersetze `addPhoto`. */
  addPhotoImpl?: typeof addPhoto;
  /** Test-Hook: ersetze die Mirror-Rebuild-Funktionen (beide!). */
  rebuildPortfolioImpl?: typeof rebuildPortfolioImagesFromModelPhotos;
  rebuildPolaroidsImpl?: typeof rebuildPolaroidsFromModelPhotos;
  /** Test-Hook: ersetze die "vorherige Package-Photos abräumen"-Funktion. */
  clearPreviousPackagePhotosImpl?: (input: {
    modelId: string;
    provider: PackageProviderId;
    providerExternalId: string;
  }) => Promise<{ deletedCount: number; deletionFailures: number }>;
  /** Pro-Download-Timeout (ms). Default {@link PACKAGE_IMAGE_DOWNLOAD_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Maximale Bytes pro Bild. Default {@link PACKAGE_IMAGE_DOWNLOAD_LIMIT_BYTES}. */
  maxBytes?: number;
  /**
   * Maximale parallele Downloads pro Album. Default 4.
   *
   * Why 4: realistische Provider-CDNs (MediaSlide GCS, später Netwalk) und
   * unsere Edge-Function-Proxy-Pfade vertragen eine kleine Concurrency, ohne
   * Throttling/429 auszulösen. >8 ist für 50-Model-Imports kontraproduktiv
   * (Speed-Gewinn marginal, Failure-Rate steigt). Tests können 1 setzen,
   * um deterministische Reihenfolge zu erzwingen.
   *
   * Reihenfolge bleibt erhalten: persistierte Photos werden NACH dem Abschluss
   * aller parallelen Downloads in Index-Reihenfolge an `addPhoto` weitergegeben,
   * damit `model_photos.sort_order` (MAX+1) deterministisch bleibt.
   */
  imageDownloadConcurrency?: number;
  /**
   * Wenn true (Default), werden VOR dem neuen Persist-Lauf alle bestehenden
   * `model_photos`-Rows mit (model_id, source=provider, api_external_id=externalId)
   * gelöscht. Damit ist Re-Import idempotent: zweiter Import desselben Packages
   * erzeugt KEINE Duplikate.
   *
   * Wir löschen ausschließlich Photos, die als Package-Import desselben Providers
   * UND derselben externalId markiert sind — eigene Uploads der Agency und
   * Photos anderer Provider/Packages bleiben unangetastet.
   *
   * Tests / spezielle Migrations-Pipelines können auf `false` setzen, um
   * additives Verhalten zu erzwingen (alte Tests vor Phase-2-Idempotenz).
   */
  clearPreviousPackagePhotos?: boolean;
  /** Optionaler Cancel — abbricht VOR dem nächsten Bild. */
  signal?: AbortSignal;
  /** Optionaler Progress-Callback (pro Bild). */
  onImageProgress?: (event: PackageImageProgress) => void;
};

export type PackageImageProgress = {
  /** Gesamtzahl Bilder (Portfolio + Polaroids). */
  total: number;
  /** Verarbeitete Bilder bisher (erfolgreich + failed). */
  done: number;
  /** Aktuelles Album. */
  type: 'portfolio' | 'polaroid';
  /** Position im Album. */
  index: number;
  /** Letztes Outcome. */
  outcome: 'persisted' | 'failed';
};

export type PersistImagesForModelInput = {
  /** Ziel-Model in unserer DB (Pflicht; verhindert Cross-Model-Leaks per Construction). */
  modelId: string;
  /** Quelle der Bilder — landet in `model_photos.source`. */
  provider: PackageProviderId;
  /** Stabile Provider-externalId — landet in `model_photos.api_external_id`. */
  providerExternalId: string;
  /** Externe Portfolio-URLs in Reihenfolge der Preview. */
  portfolioUrls: string[];
  /** Externe Polaroid-URLs in Reihenfolge der Preview. */
  polaroidUrls: string[];
  /** Optionen / Test-Hooks. */
  options?: PersistImageOptions;
};

/**
 * Hauptfunktion: persistiert alle Portfolio- und Polaroid-Bilder eines
 * Models in unseren Storage und baut die Mirror-Spalten neu auf.
 *
 * Re-Import-Idempotenz (Phase 2.1):
 *  Wenn `clearPreviousPackagePhotos` (Default true) gesetzt ist, werden
 *  ZUERST alle bestehenden `model_photos`-Rows desselben (model, provider,
 *  externalId) abgeräumt — sodass ein Re-Import desselben Packages das Modell
 *  wieder auf den frischen Soll-Zustand bringt, statt Duplikate zu schaffen.
 *  Eigene Uploads der Agency und Photos anderer Provider/Packages bleiben
 *  unangetastet.
 *
 * Reihenfolge im Persist-Lauf:
 *  Innerhalb eines Albums werden Bilder mit beschränkter Concurrency
 *  parallel HERUNTERGELADEN, danach in deterministischer Index-Reihenfolge
 *  via `addPhoto` in `model_photos` eingefügt. So bleibt `sort_order`
 *  monoton wie in der Quelle, und Race-Conditions auf MAX(sort_order)+1
 *  werden vermieden.
 *  Portfolio wird vor Polaroids verarbeitet (UI-Erwartung).
 */
function normalizePackageSourceUrlForDedupe(url: string): string {
  const t = url.trim();
  if (/^https?:\/\//i.test(t)) return t.toLowerCase();
  return t;
}

export async function persistImagesForPackageImport(
  input: PersistImagesForModelInput,
): Promise<PackageImagePersistResult> {
  const opts = input.options ?? {};
  const failures: PackageImagePersistFailure[] = [];
  let portfolioPersisted = 0;
  let polaroidPersisted = 0;

  const total = input.portfolioUrls.length + input.polaroidUrls.length;
  let done = 0;

  // -------------------------------------------------------------------------
  // Step 0: Re-Import-Cleanup. Idempotenz vor Wachstum: bestehende Photos
  // desselben Packages werden vorher gelöscht. Nur eigene Photos der Agency
  // und Photos anderer Provider/Packages bleiben unangetastet.
  // -------------------------------------------------------------------------
  const shouldClearPrevious = opts.clearPreviousPackagePhotos !== false; // default true
  let previousPackagePhotosCleared = 0;
  let previousPackagePhotosClearFailures = 0;
  if (shouldClearPrevious) {
    const clearImpl =
      opts.clearPreviousPackagePhotosImpl ?? clearPreviousPackagePhotosForModelDefault;
    try {
      const cleared = await clearImpl({
        modelId: input.modelId,
        provider: input.provider,
        providerExternalId: input.providerExternalId,
      });
      previousPackagePhotosCleared = cleared.deletedCount;
      previousPackagePhotosClearFailures = cleared.deletionFailures;
    } catch (e) {
      // Cleanup-Funktion selbst ist defensiv geschrieben (catch intern). Wenn
      // sie trotzdem wirft, blocken wir den Re-Import nicht — aber wir
      // markieren den Failure-Counter, damit das Outcome eine Warning surfacet.
      console.error('[packageImagePersistence] clearPreviousPackagePhotos threw', e);
      previousPackagePhotosClearFailures = 1;
    }
  }

  // -------------------------------------------------------------------------
  // Step 1: Bilder pro Album mit beschränkter Concurrency persistieren.
  // -------------------------------------------------------------------------
  const concurrency = Math.max(1, Math.min(opts.imageDownloadConcurrency ?? 4, 8));

  // Strict-serial fallback (concurrency=1): preserves the legacy semantics
  // "Abort hits between images, no further download starts" — only achievable
  // when download + persist + progress are interleaved 1-to-1. Tests that pin
  // abort behaviour rely on this. Production typically uses concurrency>=4.
  const persistAlbumSerial = async (
    urls: string[],
    type: 'portfolio' | 'polaroid',
  ): Promise<number> => {
    let persisted = 0;
    const seenSourceInAlbum = new Set<string>();
    for (let i = 0; i < urls.length; i++) {
      if (opts.signal?.aborted) {
        failures.push({
          index: i,
          type,
          maskedUrl: redactPackageUrl(urls[i] ?? ''),
          reason: 'download_aborted',
        });
        done++;
        opts.onImageProgress?.({ total, done, type, index: i, outcome: 'failed' });
        continue;
      }
      const url = urls[i];
      if (!url || typeof url !== 'string' || !url.trim()) {
        failures.push({
          index: i,
          type,
          maskedUrl: '[empty]',
          reason: 'invalid_url',
        });
        done++;
        opts.onImageProgress?.({ total, done, type, index: i, outcome: 'failed' });
        continue;
      }
      const dedupeKey = normalizePackageSourceUrlForDedupe(url);
      if (seenSourceInAlbum.has(dedupeKey)) {
        failures.push({
          index: i,
          type,
          maskedUrl: redactPackageUrl(url),
          reason: 'duplicate_source_url',
        });
        done++;
        opts.onImageProgress?.({ total, done, type, index: i, outcome: 'failed' });
        continue;
      }
      seenSourceInAlbum.add(dedupeKey);
      const dl = await persistOnePackageImageDownloadOnly({
        modelId: input.modelId,
        provider: input.provider,
        providerExternalId: input.providerExternalId,
        sourceUrl: url,
        photoType: type,
        index: i,
        opts,
      });
      if (!dl.ok) {
        failures.push(dl.failure);
        done++;
        opts.onImageProgress?.({ total, done, type, index: i, outcome: 'failed' });
        continue;
      }
      const fin = await finalizePackageImagePersist({
        modelId: input.modelId,
        provider: input.provider,
        providerExternalId: input.providerExternalId,
        download: dl,
        photoType: type,
        index: i,
        opts,
      });
      done++;
      if (fin.ok) {
        persisted++;
        opts.onImageProgress?.({ total, done, type, index: i, outcome: 'persisted' });
      } else {
        failures.push(fin.failure);
        opts.onImageProgress?.({ total, done, type, index: i, outcome: 'failed' });
      }
    }
    return persisted;
  };

  const persistAlbum = async (urls: string[], type: 'portfolio' | 'polaroid'): Promise<number> => {
    if (urls.length === 0) return 0;
    if (concurrency === 1) return persistAlbumSerial(urls, type);

    type Slot =
      | { kind: 'persist'; index: number; url: string }
      | { kind: 'invalid'; index: number; failure: PackageImagePersistFailure };

    // Vorab-Validierung: leere/ungültige URLs sofort als invalid markieren,
    // sie blockieren keinen Concurrency-Slot.
    // First occurrence wins; later duplicates get a deterministic failure (no extra DB row).
    const seenSourceInAlbum = new Set<string>();
    const slots: Slot[] = urls.map((url, i) => {
      if (!url || typeof url !== 'string' || !url.trim()) {
        return {
          kind: 'invalid',
          index: i,
          failure: {
            index: i,
            type,
            maskedUrl: '[empty]',
            reason: 'invalid_url',
          },
        };
      }
      const dedupeKey = normalizePackageSourceUrlForDedupe(url);
      if (seenSourceInAlbum.has(dedupeKey)) {
        return {
          kind: 'invalid',
          index: i,
          failure: {
            index: i,
            type,
            maskedUrl: redactPackageUrl(url),
            reason: 'duplicate_source_url',
          },
        };
      }
      seenSourceInAlbum.add(dedupeKey);
      return { kind: 'persist', index: i, url };
    });

    // Ergebnisse in deterministischer Index-Reihenfolge — wir füllen das
    // Array beim Worker-Abschluss und reporten am Ende sortiert. So bleibt
    // `model_photos.sort_order` monoton.
    type PersistOutcome =
      | { ok: true; index: number; result: PersistOneDownloadResult & { ok: true } }
      | { ok: false; index: number; failure: PackageImagePersistFailure };
    const results: (PersistOutcome | undefined)[] = new Array(slots.length).fill(undefined);

    let next = 0;
    const launchWorker = async (): Promise<void> => {
      while (next < slots.length) {
        const myIdx = next++;
        const slot = slots[myIdx];
        if (slot.kind === 'invalid') {
          results[myIdx] = { ok: false, index: slot.index, failure: slot.failure };
          continue;
        }
        if (opts.signal?.aborted) {
          results[myIdx] = {
            ok: false,
            index: slot.index,
            failure: {
              index: slot.index,
              type,
              maskedUrl: redactPackageUrl(slot.url),
              reason: 'download_aborted',
            },
          };
          continue;
        }
        const r = await persistOnePackageImageDownloadOnly({
          modelId: input.modelId,
          provider: input.provider,
          providerExternalId: input.providerExternalId,
          sourceUrl: slot.url,
          photoType: type,
          index: slot.index,
          opts,
        });
        if (r.ok) {
          results[myIdx] = { ok: true, index: slot.index, result: r };
        } else {
          results[myIdx] = { ok: false, index: slot.index, failure: r.failure };
        }
      }
    };

    const workers: Array<Promise<void>> = [];
    for (let w = 0; w < Math.min(concurrency, slots.length); w++) {
      workers.push(launchWorker());
    }
    await Promise.all(workers);

    // Step 1b: Persist successful downloads in INDEX order via `addPhoto`.
    // Sequential here because `addPhoto` resolves sort_order via MAX+1 — a
    // parallel write would race the sort_order calculation.
    let persisted = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (r.ok) {
        const finalRes = await finalizePackageImagePersist({
          modelId: input.modelId,
          provider: input.provider,
          providerExternalId: input.providerExternalId,
          download: r.result,
          photoType: type,
          index: r.index,
          opts,
        });
        done++;
        if (finalRes.ok) {
          persisted++;
          opts.onImageProgress?.({
            total,
            done,
            type,
            index: r.index,
            outcome: 'persisted',
          });
        } else {
          failures.push(finalRes.failure);
          opts.onImageProgress?.({
            total,
            done,
            type,
            index: r.index,
            outcome: 'failed',
          });
        }
      } else {
        failures.push(r.failure);
        done++;
        opts.onImageProgress?.({
          total,
          done,
          type,
          index: r.index,
          outcome: 'failed',
        });
      }
    }
    return persisted;
  };

  portfolioPersisted = await persistAlbum(input.portfolioUrls, 'portfolio');
  polaroidPersisted = await persistAlbum(input.polaroidUrls, 'polaroid');

  // Mirror-Spalten neu aufbauen — pro Album NUR wenn dieses Album mindestens
  // ein Bild erfolgreich persistiert hat. Hintergrund (siehe
  // `package-import-invariants.mdc` D2 / "Legacy-Mirror-Schutz"):
  //
  // `rebuildPortfolioImagesFromModelPhotos` / `rebuildPolaroidsFromModelPhotos`
  // bauen die Mirror-Spalten EXKLUSIV aus `model_photos`-Zeilen. Würden wir
  // nach einem komplett fehlgeschlagenen Persist-Lauf trotzdem rebuilden,
  // würden für ein bestehendes Legacy-Modell mit alten externen URLs in
  // `models.portfolio_images` / `models.polaroids` (vor Phase 2 importiert)
  // diese Spalten still auf `[]` gesetzt — destruktiver Datenverlust ohne
  // ehrliche Sichtbarkeit. Statt zu wipen bleibt der Vorzustand erhalten;
  // `commitPreview` markiert das Outcome je nach `classifyImagePersistResult`
  // ehrlich als `warning` (`all_images_persistence_failed` / `partial`).
  //
  // Für NEU-Inserts (ohne Vorzustand) ist das Verhalten identisch korrekt:
  // bei 0 persistiert bleiben die initialen `[]` aus dem Importer stehen.
  let mirrorRebuilt = true;
  const shouldRebuildPortfolio = portfolioPersisted > 0;
  const shouldRebuildPolaroids = polaroidPersisted > 0;
  if (shouldRebuildPortfolio || shouldRebuildPolaroids) {
    try {
      const rebuildPortfolio = opts.rebuildPortfolioImpl ?? rebuildPortfolioImagesFromModelPhotos;
      const rebuildPolaroids = opts.rebuildPolaroidsImpl ?? rebuildPolaroidsFromModelPhotos;
      const tasks: Array<Promise<boolean>> = [];
      if (shouldRebuildPortfolio) tasks.push(rebuildPortfolio(input.modelId));
      if (shouldRebuildPolaroids) tasks.push(rebuildPolaroids(input.modelId));
      const results = await Promise.all(tasks);
      mirrorRebuilt = results.every(Boolean);
    } catch (e) {
      console.error('[packageImagePersistence] mirror rebuild exception', {
        modelId: input.modelId,
        message: e instanceof Error ? e.message : 'unknown',
      });
      mirrorRebuilt = false;
    }
  }

  return {
    portfolioPersisted,
    portfolioAttempted: input.portfolioUrls.length,
    polaroidPersisted,
    polaroidAttempted: input.polaroidUrls.length,
    failures,
    mirrorRebuilt,
    previousPackagePhotosCleared,
    previousPackagePhotosClearFailures,
  };
}

// ---------------------------------------------------------------------------
// Re-Import-Idempotenz: alle bestehenden model_photos desselben Packages
// löschen, bevor neue persistiert werden.
//
// Wir matchen STRENG auf (model_id, source=provider, api_external_id=externalId)
// → eigene Uploads (source=null) und Photos anderer Provider/Packages bleiben
// unangetastet. Storage-Objects werden über `deletePhoto` mit abgeräumt
// (sonst würden sie als Quota-Müll bleiben).
// ---------------------------------------------------------------------------
async function clearPreviousPackagePhotosForModelDefault(input: {
  modelId: string;
  provider: PackageProviderId;
  providerExternalId: string;
}): Promise<{ deletedCount: number; deletionFailures: number }> {
  try {
    const { supabase } = await import('../../lib/supabase');
    const { data: rows, error } = await supabase
      .from('model_photos')
      .select('id, url')
      .eq('model_id', input.modelId)
      .eq('source', input.provider)
      .eq('api_external_id', input.providerExternalId);

    if (error) {
      console.error('[packageImagePersistence] clearPreviousPackagePhotos query error', error);
      return { deletedCount: 0, deletionFailures: 1 };
    }

    const list = (rows ?? []) as Array<{ id: string; url: string }>;
    if (list.length === 0) return { deletedCount: 0, deletionFailures: 0 };

    let deletedCount = 0;
    let deletionFailures = 0;
    // Sequential: deletePhoto already does Storage + DB; parallelizing here
    // would risk Storage rate-limits and gives no meaningful speedup at the
    // cap of ~30 photos per package.
    for (const r of list) {
      const ok = await deletePhoto(r.id, r.url);
      if (ok) deletedCount++;
      else deletionFailures++;
    }
    return { deletedCount, deletionFailures };
  } catch (e) {
    console.error('[packageImagePersistence] clearPreviousPackagePhotos exception', e);
    return { deletedCount: 0, deletionFailures: 1 };
  }
}

// ---------------------------------------------------------------------------
// Two-phase per-image flow used by the parallel pipeline:
//   1. `persistOnePackageImageDownloadOnly` — runs in parallel workers,
//      handles download + upload to storage. NO `addPhoto` insert here, so
//      `model_photos.sort_order` (MAX+1) does not race across workers.
//   2. `finalizePackageImagePersist` — sequential per album, writes the
//      `model_photos` row in deterministic index order.
// ---------------------------------------------------------------------------

type PersistOneDownloadInput = {
  modelId: string;
  provider: PackageProviderId;
  providerExternalId: string;
  sourceUrl: string;
  photoType: 'portfolio' | 'polaroid';
  index: number;
  opts: PersistImageOptions;
};

type PersistOneDownloadResult =
  | {
      ok: true;
      storageUri: string;
      fileSizeBytes: number;
      maskedUrl: string;
    }
  | { ok: false; failure: PackageImagePersistFailure };

async function persistOnePackageImageDownloadOnly(
  input: PersistOneDownloadInput,
): Promise<PersistOneDownloadResult> {
  const masked = redactPackageUrl(input.sourceUrl);

  const dl = await downloadImageBytes({
    url: input.sourceUrl,
    fetchImpl: input.opts.fetchImpl ?? fetch,
    timeoutMs: input.opts.timeoutMs ?? PACKAGE_IMAGE_DOWNLOAD_TIMEOUT_MS,
    maxBytes: input.opts.maxBytes ?? PACKAGE_IMAGE_DOWNLOAD_LIMIT_BYTES,
    signal: input.opts.signal,
  });

  if (!dl.ok) {
    return {
      ok: false,
      failure: {
        index: input.index,
        type: input.photoType,
        maskedUrl: masked,
        reason: dl.reason,
        detail: dl.detail,
      },
    };
  }

  const file = blobToImportFile(dl.blob, dl.contentType, input.providerExternalId, input.index);

  const upload = input.opts.uploadImpl ?? uploadModelPhoto;
  // upload routes to the model-scoped storage path; modelId here is critical
  // for both bucket pathing and `agency_storage` quota accounting.
  const uploadResult = await upload(input.modelId, file, { skipConsentCheck: true });
  if (!uploadResult) {
    return {
      ok: false,
      failure: {
        index: input.index,
        type: input.photoType,
        maskedUrl: masked,
        reason: 'upload_failed',
      },
    };
  }
  return {
    ok: true,
    storageUri: uploadResult.url,
    fileSizeBytes: uploadResult.fileSizeBytes,
    maskedUrl: masked,
  };
}

type FinalizeInput = {
  modelId: string;
  provider: PackageProviderId;
  providerExternalId: string;
  download: { storageUri: string; fileSizeBytes: number; maskedUrl: string };
  photoType: 'portfolio' | 'polaroid';
  index: number;
  opts: PersistImageOptions;
};

type FinalizeResult =
  | { ok: true; storageUri: string; photoId: string }
  | { ok: false; failure: PackageImagePersistFailure };

async function finalizePackageImagePersist(input: FinalizeInput): Promise<FinalizeResult> {
  const insertPhoto = input.opts.addPhotoImpl ?? addPhoto;
  const photoTypeForRow: ModelPhotoType = input.photoType;
  const photoRow = await insertPhoto(
    input.modelId,
    input.download.storageUri,
    photoTypeForRow,
    input.download.fileSizeBytes,
  );

  if (!photoRow) {
    console.error('[packageImagePersistence] addPhoto failed after upload', {
      modelId: input.modelId,
      maskedUrl: input.download.maskedUrl,
    });
    return {
      ok: false,
      failure: {
        index: input.index,
        type: input.photoType,
        maskedUrl: input.download.maskedUrl,
        reason: 'addphoto_failed',
      },
    };
  }

  // Source-/Provider-Felder nachreichen (provider, externalId), damit
  // model_photos klar als Package-Import erkennbar ist. Fire-and-forget:
  // Fehler hier dürfen die Persistenz nicht scheitern lassen (Bild ist
  // physisch in Storage und in model_photos verfügbar).
  void updatePhotoSourceFields(photoRow.id, input.provider, input.providerExternalId);

  return { ok: true, storageUri: input.download.storageUri, photoId: photoRow.id };
}

async function updatePhotoSourceFields(
  photoId: string,
  provider: PackageProviderId,
  providerExternalId: string,
): Promise<void> {
  try {
    // Lazy import to avoid cycle with services that re-export this file.
    const { supabase } = await import('../../lib/supabase');
    const { error } = await supabase
      .from('model_photos')
      .update({
        source: provider,
        api_external_id: providerExternalId,
      })
      .eq('id', photoId);
    if (error) {
      console.warn('[packageImagePersistence] updatePhotoSourceFields failed', {
        photoId,
        message: error.message,
      });
    }
  } catch (e) {
    console.warn('[packageImagePersistence] updatePhotoSourceFields exception', {
      photoId,
      message: e instanceof Error ? e.message : 'unknown',
    });
  }
}

type DownloadInput = {
  url: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxBytes: number;
  signal?: AbortSignal;
};

type DownloadOk = { ok: true; blob: Blob; contentType: string };
type DownloadFail = {
  ok: false;
  reason: PackageImagePersistFailureReason;
  detail?: string;
};

/**
 * Lädt ein Bild kontrolliert herunter:
 *  - hartes Timeout via internem AbortController
 *  - status >= 400 → `download_http_error`
 *  - content-type prüft auf image/* (Whitelist)
 *  - content-length prüft Pre-Limit (wenn Header gesetzt)
 *  - Body wird gestreamt und bei Überlauf abgebrochen
 *  - leeres Body → `empty_response`
 */
async function downloadImageBytes(input: DownloadInput): Promise<DownloadOk | DownloadFail> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  const externalSignal = input.signal;
  externalSignal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctrl.abort(), input.timeoutMs);

  try {
    let res: Response;
    try {
      res = await input.fetchImpl(input.url, {
        method: 'GET',
        redirect: 'follow',
        signal: ctrl.signal,
        // Wir geben absichtlich KEIN Cookie / Auth weiter — Provider-CDN
        // soll uns wie einen anonymen Client behandeln. Das verhindert,
        // dass session-spezifische Hashes leaken.
      });
    } catch (e) {
      if (externalSignal?.aborted) {
        return { ok: false, reason: 'download_aborted' };
      }
      const name = (e as Error)?.name;
      if (name === 'AbortError') {
        return { ok: false, reason: 'download_timeout' };
      }
      return {
        ok: false,
        reason: 'download_network',
        detail: (e as Error)?.message ?? 'fetch_failed',
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        reason: 'download_http_error',
        detail: String(res.status),
      };
    }

    const rawType = (res.headers as Headers).get?.('content-type') ?? '';
    const contentType = rawType.split(';')[0]?.trim().toLowerCase() ?? '';
    if (
      !ALLOWED_DOWNLOAD_CONTENT_TYPES.includes(
        contentType as (typeof ALLOWED_DOWNLOAD_CONTENT_TYPES)[number],
      )
    ) {
      return {
        ok: false,
        reason: 'invalid_content_type',
        detail: contentType || 'missing',
      };
    }

    const cl = (res.headers as Headers).get?.('content-length');
    if (cl) {
      const n = Number(cl);
      if (Number.isFinite(n) && n > input.maxBytes) {
        return { ok: false, reason: 'too_large', detail: `${n}` };
      }
    }

    const blob = await res.blob();
    if (!blob || blob.size === 0) {
      return { ok: false, reason: 'empty_response' };
    }
    if (blob.size > input.maxBytes) {
      return { ok: false, reason: 'too_large', detail: `${blob.size}` };
    }

    return { ok: true, blob, contentType: blob.type || contentType };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Wandelt einen heruntergeladenen Blob in ein `File` mit deterministischem
 * Namen um. `uploadModelPhoto` braucht eine `.ext`, um die magic-bytes-/
 * Extension-Konsistenz zu prüfen. Wir leiten die Extension aus dem MIME ab.
 */
function blobToImportFile(
  blob: Blob,
  contentType: string,
  providerExternalId: string,
  index: number,
): File | Blob {
  const ext = mimeToExtension(contentType);
  const baseId = providerExternalId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'pkg';
  const name = `pkg-${baseId}-${index}.${ext}`;
  if (typeof File !== 'undefined') {
    try {
      return new File([blob], name, { type: contentType });
    } catch {
      return blob;
    }
  }
  return blob;
}

function mimeToExtension(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
      return 'heic';
    case 'image/heif':
      return 'heif';
    default:
      return 'jpg';
  }
}

/**
 * Zusammenfassende Helpers, die `commitPreview` braucht, um pro Model klar
 * zu entscheiden, wie das Outcome zu klassifizieren ist.
 */
export function classifyImagePersistResult(
  result: PackageImagePersistResult,
): 'all_ok' | 'partial' | 'all_failed' | 'no_images' {
  const totalAttempted = result.portfolioAttempted + result.polaroidAttempted;
  if (totalAttempted === 0) return 'no_images';
  const persisted = result.portfolioPersisted + result.polaroidPersisted;
  if (persisted === 0) return 'all_failed';
  if (persisted === totalAttempted) return 'all_ok';
  return 'partial';
}
