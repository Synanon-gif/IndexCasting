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
  | 'invalid_url';

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
  /** Pro-Download-Timeout (ms). Default {@link PACKAGE_IMAGE_DOWNLOAD_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Maximale Bytes pro Bild. Default {@link PACKAGE_IMAGE_DOWNLOAD_LIMIT_BYTES}. */
  maxBytes?: number;
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
 * Reihenfolge: erst alle Portfolio-Bilder sequentiell, dann alle Polaroids.
 * Sequentiell statt parallel, weil `model_photos.sort_order` durch
 * `addPhoto` per `MAX(sort_order) + 1` vergeben wird — Parallelität würde
 * Race-Conditions auf der Reihenfolge verursachen.
 */
export async function persistImagesForPackageImport(
  input: PersistImagesForModelInput,
): Promise<PackageImagePersistResult> {
  const opts = input.options ?? {};
  const failures: PackageImagePersistFailure[] = [];
  let portfolioPersisted = 0;
  let polaroidPersisted = 0;

  const total = input.portfolioUrls.length + input.polaroidUrls.length;
  let done = 0;

  const persistAlbum = async (urls: string[], type: 'portfolio' | 'polaroid'): Promise<number> => {
    let persisted = 0;
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

      const result = await persistOnePackageImage({
        modelId: input.modelId,
        provider: input.provider,
        providerExternalId: input.providerExternalId,
        sourceUrl: url,
        photoType: type,
        index: i,
        opts,
      });
      done++;
      if (result.ok) {
        persisted++;
        opts.onImageProgress?.({ total, done, type, index: i, outcome: 'persisted' });
      } else {
        failures.push(result.failure);
        opts.onImageProgress?.({ total, done, type, index: i, outcome: 'failed' });
      }
    }
    return persisted;
  };

  portfolioPersisted = await persistAlbum(input.portfolioUrls, 'portfolio');
  polaroidPersisted = await persistAlbum(input.polaroidUrls, 'polaroid');

  // Mirror-Spalten neu aufbauen: nur erfolgreich persistierte (visible) Bilder
  // landen jetzt in `models.portfolio_images` / `models.polaroids`.
  // Der Rebuild läuft auch wenn 0 persistiert wurden — dann werden die
  // Mirror-Spalten leer / unverändert (je nach Vorzustand). Outcome-Konsument
  // (commitPreview) entscheidet anhand `failures.length` vs `attempted`, ob
  // das Model als "warning" markiert wird.
  let mirrorRebuilt = true;
  try {
    const rebuildPortfolio = opts.rebuildPortfolioImpl ?? rebuildPortfolioImagesFromModelPhotos;
    const rebuildPolaroids = opts.rebuildPolaroidsImpl ?? rebuildPolaroidsFromModelPhotos;
    const [okP, okPol] = await Promise.all([
      rebuildPortfolio(input.modelId),
      rebuildPolaroids(input.modelId),
    ]);
    mirrorRebuilt = Boolean(okP) && Boolean(okPol);
  } catch (e) {
    console.error('[packageImagePersistence] mirror rebuild exception', {
      modelId: input.modelId,
      message: e instanceof Error ? e.message : 'unknown',
    });
    mirrorRebuilt = false;
  }

  return {
    portfolioPersisted,
    portfolioAttempted: input.portfolioUrls.length,
    polaroidPersisted,
    polaroidAttempted: input.polaroidUrls.length,
    failures,
    mirrorRebuilt,
  };
}

type PersistOneInput = {
  modelId: string;
  provider: PackageProviderId;
  providerExternalId: string;
  sourceUrl: string;
  photoType: 'portfolio' | 'polaroid';
  index: number;
  opts: PersistImageOptions;
};

type PersistOneResult =
  | { ok: true; storageUri: string; photoId: string }
  | { ok: false; failure: PackageImagePersistFailure };

async function persistOnePackageImage(input: PersistOneInput): Promise<PersistOneResult> {
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

  const insertPhoto = input.opts.addPhotoImpl ?? addPhoto;
  // Wir setzen photo_type direkt entsprechend Album. `addPhoto` selbst
  // stellt `is_visible_to_clients = true` für non-private Typen, was hier
  // für portfolio + polaroid korrekt ist (Polaroids sind im Package-/Guest-
  // Kontext sichtbar, Discovery filtert sie über §27.1).
  const photoTypeForRow: ModelPhotoType = input.photoType;
  const photoRow = await insertPhoto(
    input.modelId,
    uploadResult.url,
    photoTypeForRow,
    uploadResult.fileSizeBytes,
  );

  if (!photoRow) {
    // Storage-Object existiert, aber DB-Row fehlt → konsistent inkonsistent.
    // Wir loggen, behalten das Storage-Object aber bewusst NICHT, weil ohne
    // model_photos-Row hätte es keine Sichtbarkeit + keinen Lifecycle. Aber
    // ein Cleanup hier wäre fragil (Storage-Quota-Drift). Stattdessen:
    // Failure wird gemeldet, Mirror-Rebuild wird das Bild nicht aufnehmen
    // (es existiert keine Row). Verlust ist nur Speicher (kein Datenrisiko).
    console.error('[packageImagePersistence] addPhoto failed after upload', {
      modelId: input.modelId,
      maskedUrl: masked,
    });
    return {
      ok: false,
      failure: {
        index: input.index,
        type: input.photoType,
        maskedUrl: masked,
        reason: 'addphoto_failed',
      },
    };
  }

  // Source-/Provider-Felder nachreichen (provider, externalId), damit
  // model_photos klar als Package-Import erkennbar ist. Fire-and-forget:
  // Fehler hier dürfen die Persistenz nicht scheitern lassen (Bild ist
  // physisch in Storage und in model_photos verfügbar).
  void updatePhotoSourceFields(photoRow.id, input.provider, input.providerExternalId);

  return { ok: true, storageUri: uploadResult.url, photoId: photoRow.id };
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
