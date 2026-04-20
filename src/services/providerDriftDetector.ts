/**
 * Provider Drift Detector — provider-agnostische Heuristik, ob ein Parser-Run
 * "gesund" aussieht oder ob Format-Drift vorliegt.
 *
 * Liefert ein strukturiertes `DriftResult` mit Severity + Reason-Codes. Provider
 * MÜSSEN bei `severity === 'hard_block'` eine `ParserDriftError` werfen, statt
 * stillschweigend weiterzumachen (siehe `packageImportTypes.ts`).
 *
 * KEIN HTTP, KEIN State, 100 % deterministisch und unit-testbar.
 */

import type {
  DriftResult,
  DriftSeverity,
  PackageProviderId,
  ProviderImportPayload,
} from './packageImportTypes';

export const PROVIDER_DRIFT_THRESHOLDS = {
  /** Mindest-Anteil gefundener `expectedAnchors` im List-HTML. */
  MIN_ANCHOR_COVERAGE: 0.7,
  /** Mindest-Anteil vollständig geparster Karten (vs. erkannte Container). */
  MIN_EXTRACTION_RATIO: 0.5,
  /** Mindest-Anteil verwertbarer Books (Bilder ODER Maße vorhanden). */
  MIN_BOOK_OK_RATIO: 0.6,
} as const;

export const MEDIASLIDE_PARSER_VERSION = 'mediaslide-2026-04';
export const NETWALK_PARSER_VERSION = 'netwalk-stub-2026-04';

/**
 * Pflicht-Anker, die in einem gesunden MediaSlide-List-HTML vorkommen.
 * Werden case-insensitive gesucht. Bewusst breit, nicht zu spezifisch.
 */
export const MEDIASLIDE_LIST_ANCHORS = [
  'class="packageModel"',
  'data-model-id=',
  'class="modelName"',
  'href="#book-',
  'pictures/',
] as const;

export type AnchorCoverage = {
  coverage: number;
  missing: string[];
};

export function analyzeListAnchors(
  html: string,
  expectedAnchors: readonly string[],
): AnchorCoverage {
  if (expectedAnchors.length === 0) return { coverage: 1, missing: [] };
  const lower = (html ?? '').toLowerCase();
  const missing: string[] = [];
  for (const anchor of expectedAnchors) {
    if (!lower.includes(anchor.toLowerCase())) missing.push(anchor);
  }
  const coverage = (expectedAnchors.length - missing.length) / expectedAnchors.length;
  return { coverage, missing };
}

/**
 * Maskiert eine URL für Logs / UI: behält Schema, Host und das erste Pfadsegment;
 * verwirft Query-String und tiefere Pfadteile (die Tokens enthalten könnten).
 */
export function maskUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const segs = u.pathname.split('/').filter(Boolean);
    const firstSeg = segs[0] ? `/${segs[0]}` : '';
    const tail = segs.length > 1 ? '/…' : '';
    return `${u.protocol}//${u.host}${firstSeg}${tail}`;
  } catch {
    return '<invalid-url>';
  }
}

export type EvaluateRunDriftInput = {
  providerId: PackageProviderId;
  parserVersion: string;
  url: string;
  listHtml: string;
  expectedAnchors: readonly string[];
  /** Anzahl Container, die der Parser im List-HTML erkannt (aber nicht zwingend extrahiert) hat. */
  cardsDetected: number;
  /** Davon erfolgreich vollständig geparst (mit externalId + Name). */
  cardsExtracted: number;
  /**
   * Roh-Payloads nach Book-Fetch. Werden nur für `bookOkRatio` ausgewertet —
   * ein Payload gilt als "ok", wenn er mindestens 1 Bild ODER eine Höhe besitzt
   * UND nicht via `forceSkipReason` als unvollständig markiert wurde.
   */
  payloads: ProviderImportPayload[];
};

export function evaluateRunDrift(input: EvaluateRunDriftInput): DriftResult {
  const { coverage, missing } = analyzeListAnchors(input.listHtml, input.expectedAnchors);

  const extractionRatio =
    input.cardsDetected > 0
      ? Math.min(1, input.cardsExtracted / input.cardsDetected)
      : input.cardsExtracted > 0
        ? 1
        : 0;

  const bookOkRatio = computeBookOkRatio(input.payloads);

  const reasonCodes: string[] = [];
  let severity: DriftSeverity = 'ok';

  if (coverage < PROVIDER_DRIFT_THRESHOLDS.MIN_ANCHOR_COVERAGE) {
    reasonCodes.push('parser_anchor_coverage_low');
    severity = 'hard_block';
  }
  if (extractionRatio < PROVIDER_DRIFT_THRESHOLDS.MIN_EXTRACTION_RATIO) {
    reasonCodes.push('parser_extraction_low');
    severity = 'hard_block';
  }
  if (input.payloads.length > 0 && bookOkRatio < PROVIDER_DRIFT_THRESHOLDS.MIN_BOOK_OK_RATIO) {
    reasonCodes.push('parser_book_quality_low');
    severity = 'hard_block';
  }

  if (severity === 'ok' && missing.length > 0) {
    reasonCodes.push('parser_anchor_partial');
    severity = 'soft_warn';
  }

  return {
    severity,
    parserVersion: input.parserVersion,
    providerId: input.providerId,
    maskedUrl: maskUrl(input.url),
    anchorCoverage: round3(coverage),
    missingAnchors: missing,
    extractionRatio: round3(extractionRatio),
    bookOkRatio: round3(bookOkRatio),
    reasonCodes,
    cardsDetected: input.cardsDetected,
    cardsExtracted: input.cardsExtracted,
  };
}

function computeBookOkRatio(payloads: ProviderImportPayload[]): number {
  if (payloads.length === 0) return 1;
  let ok = 0;
  for (const p of payloads) {
    const hasImages =
      (p.portfolio_image_urls?.length ?? 0) > 0 || (p.polaroid_image_urls?.length ?? 0) > 0;
    const hasHeight = p.measurements?.height != null;
    if ((hasImages || hasHeight) && !p.forceSkipReason) ok++;
  }
  return ok / payloads.length;
}

function round3(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}
