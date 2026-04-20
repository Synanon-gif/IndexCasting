/**
 * Provider-neutrale Typen für den Agency-seitigen Package-Import (MediaSlide jetzt, Netwalk später).
 *
 * Diese Datei enthält bewusst keine MediaSlide-spezifischen Begriffe. Sie ist die schmale
 * Schnittstelle zwischen Provider-Adaptern (z. B. `mediaslidePackageProvider`) und dem
 * generischen Importer (`packageImporter`). Damit kann ein zweiter Adapter (Netwalk)
 * später eingehängt werden, ohne den Importer oder die UI anzufassen.
 *
 * WICHTIG: Bildmengen-Caps werden ausschließlich im Importer angewendet — nicht im Provider/Parser.
 * Das hält Provider-Adapter dumm und einfach und garantiert eine einheitliche Produkt-Regel.
 */

export type PackageProviderId = 'mediaslide' | 'netwalk';

/**
 * Roh-Payload, den ein Provider-Adapter pro Model liefert.
 * Bilder sind hier noch nicht gecappt; Caps macht der Importer (siehe `packageImporter.ts`).
 */
export type ProviderImportPayload = {
  externalProvider: PackageProviderId;
  /** Provider-stabiler Re-Import-Key. Pflicht. Z. B. MediaSlide `data-model-id`. */
  externalId: string;
  /** Anzeigename, NFC-normalisiert und getrimmt. Pflicht. */
  name: string;
  /** Optionales Cover-Thumbnail aus der Listenansicht (für Preview-UI). */
  coverImageUrl?: string | null;
  measurements: {
    height?: number | null;
    bust?: number | null;
    waist?: number | null;
    hips?: number | null;
    chest?: number | null;
    legs_inseam?: number | null;
    shoe_size?: number | null;
  };
  /** Freitext direkt aus dem Provider — keine Enum-Mapping-Pflicht. */
  hair_color_raw?: string | null;
  eye_color_raw?: string | null;
  /** Optionaler Instagram-Handle (ohne führendes `@`). */
  instagram?: string | null;
  /** Portfolio-Bild-URLs in Provider-DOM-Reihenfolge. Noch nicht gecappt. */
  portfolio_image_urls: string[];
  /** Polaroid-Bild-URLs in Provider-DOM-Reihenfolge. Noch nicht gecappt. */
  polaroid_image_urls: string[];
  /**
   * Weitere Album-Typen (z. B. DIGITALS, TESTS) als Zähler — nur informativ
   * für die Preview-UI, werden in Phase 1 nicht persistiert.
   */
  extra_album_counts?: Record<string, number>;
  /** Provider-/Parser-Warnungen, die im Preview pro Model angezeigt werden. */
  warnings?: string[];
  /**
   * Wenn gesetzt, MUSS der Importer dieses Model als `skipped` mit diesem Reason
   * behandeln — auch wenn andere Felder formal "ready" wären. Wird vom Provider
   * gesetzt, wenn der Roh-Payload nachweislich unvollständig ist (z. B. Book-Fetch
   * komplett fehlgeschlagen, nur Listen-Hint vorhanden).
   */
  forceSkipReason?: string;
};

// ---------------------------------------------------------------------------
// Drift detection
// ---------------------------------------------------------------------------

export type DriftSeverity = 'ok' | 'soft_warn' | 'hard_block';

/**
 * Strukturiertes Drift-Ergebnis pro Analyze-Run.
 * Wird vom Provider an den Importer/UI weitergereicht. Enthält bewusst KEINE
 * roh-HTML-Snippets — nur aggregierte Signale + maskierte URL.
 */
export type DriftResult = {
  severity: DriftSeverity;
  /** Stabiler Versions-Tag des Parsers (z. B. "mediaslide-2026-04"). */
  parserVersion: string;
  providerId: PackageProviderId;
  /** Maskierte Quelle (Host + 1 Pfadsegment, ohne Query). */
  maskedUrl: string;
  /** Anteil gefundener `expectedListAnchors` (0..1). */
  anchorCoverage: number;
  /** Welche Pflicht-Anker fehlen (für Logging/UI). */
  missingAnchors: string[];
  /** Anteil erfolgreich vollständig geparster Karten (0..1). */
  extractionRatio: number;
  /** Anteil Books mit verwertbarem Output (0..1). 1.0 wenn keine Books erwartet. */
  bookOkRatio: number;
  /** Maschinenlesbare Reason-Codes (`parser_anchor_coverage_low`, ...). */
  reasonCodes: string[];
  /** Anzahl Container im List-HTML. */
  cardsDetected: number;
  /** Anzahl davon vollständig geparst. */
  cardsExtracted: number;
};

/**
 * Error-Klasse für Drift-Hard-Blocks. Provider werfen diese statt eines generischen
 * Errors, sodass die UI das angehängte DriftResult sicher auspacken kann.
 *
 * `message` ist immer `'parser_drift_detected'`, sodass bestehende Handler, die nur
 * auf den Error-Code matchen, weiterhin funktionieren.
 */
export class ParserDriftError extends Error {
  public readonly drift: DriftResult;
  constructor(drift: DriftResult) {
    super('parser_drift_detected');
    this.name = 'ParserDriftError';
    this.drift = drift;
  }
}

export function isParserDriftError(e: unknown): e is ParserDriftError {
  return e instanceof Error && e.name === 'ParserDriftError' && 'drift' in e;
}

/** Fortschritts-Callback während der Provider-Analyse-Phase. */
export type AnalyzeProgress = {
  phase: 'fetch_list' | 'fetch_books' | 'parse';
  modelsTotal: number;
  modelsDone: number;
  /** Optionaler Hinweis für die UI ("REMI – Portfolio"). */
  currentLabel?: string;
};

/** Adapter-Interface, das jeder Provider implementieren muss. */
export type PackageProvider = {
  id: PackageProviderId;
  /** Liefert true, wenn der Adapter die URL beanspruchen will. */
  detect: (input: { url: string }) => boolean;
  /**
   * Lädt und parst das Package vollständig in eine Liste von Roh-Payloads.
   * Darf werfen mit aussagekräftigem Fehlertext (z. B. "package_unreachable").
   */
  analyze: (input: {
    url: string;
    signal?: AbortSignal;
    onProgress?: (s: AnalyzeProgress) => void;
    /**
     * Optional callback for non-fatal drift signals (`soft_warn` or `ok`).
     * Hard-Block drift causes a thrown `ParserDriftError` instead.
     */
    onDrift?: (drift: DriftResult) => void;
    /**
     * Wenn true, wirft der Provider KEINE `ParserDriftError` mehr — Drift wird
     * nur via `onDrift` gemeldet. Wird ausschließlich vom expliziten Admin-
     * Override gesetzt, NICHT als Default. Pflichtfeld-Checks im Importer
     * greifen weiterhin.
     */
    allowDriftBypass?: boolean;
  }) => Promise<ProviderImportPayload[]>;
};

/**
 * Aus dem Importer abgeleitetes Preview-Objekt.
 * Zeigt der Agency vor dem Commit transparent, was importiert würde — inkl. verworfener Bilder.
 */
export type PreviewModel = {
  externalProvider: PackageProviderId;
  externalId: string;
  name: string;
  coverImageUrl?: string | null;
  /** Status nach Provider-Parse (vor DB-Lookup). */
  status: 'ready' | 'skipped';
  /** Warum `skipped`? Pflicht wenn status === 'skipped'. */
  skipReason?: string;
  measurements: ProviderImportPayload['measurements'];
  hair_color_raw?: string | null;
  eye_color_raw?: string | null;
  instagram?: string | null;
  /** Bilder NACH Dedup + Cap. */
  portfolio_image_urls: string[];
  polaroid_image_urls: string[];
  /** Wieviele Bilder über dem Cap verworfen wurden (transparent für UI). */
  discardedPortfolio: number;
  discardedPolaroids: number;
  extra_album_counts?: Record<string, number>;
  warnings: string[];
};

export type CommitOptions = {
  /**
   * Wenn true und das Model via mediaslide_sync_id matcht, werden Maße immer überschrieben.
   * Default: false → bestehende Werte bleiben, nur Lücken werden gefüllt.
   */
  forceUpdateMeasurements?: boolean;
};

export type CommitProgress = {
  total: number;
  done: number;
  currentLabel?: string;
};

export type CommitOutcome = {
  externalId: string;
  name: string;
  status: 'created' | 'merged' | 'warning' | 'error' | 'skipped';
  modelId?: string;
  reason?: string;
};

export type CommitSummary = {
  outcomes: CommitOutcome[];
  createdCount: number;
  mergedCount: number;
  warningCount: number;
  errorCount: number;
  skippedCount: number;
};

/** Harte Bildmengen-Caps pro Model. Bewusst niedrig + transparent in der UI. */
export const PACKAGE_IMPORT_LIMITS = {
  MAX_PORTFOLIO_IMAGES_PER_MODEL: 20,
  MAX_POLAROIDS_PER_MODEL: 10,
  /** Soft-Hint in der UI; harte Obergrenze pro Run. */
  SOFT_MODELS_PER_RUN: 60,
  MAX_MODELS_PER_RUN: 100,
} as const;
