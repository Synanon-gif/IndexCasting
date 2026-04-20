/**
 * MediaSlide Package Provider — Adapter, der das provider-neutrale
 * `PackageProvider`-Interface erfüllt.
 *
 * Kombiniert Fetcher (HTTP) + Parser (DOM) und liefert `ProviderImportPayload[]`.
 * Erkennt Album-Typ ("PORTFOLIO" / "POLAROIDS" / sonstige) und mappt auf die
 * neutralen Felder `portfolio_image_urls` / `polaroid_image_urls` /
 * `extra_album_counts`.
 *
 * KEINE Caps, KEINE DB-Logik, KEINE UI-Begriffe in dieser Datei.
 */

import type {
  AnalyzeProgress,
  DriftResult,
  PackageProvider,
  ProviderImportPayload,
} from './packageImportTypes';
import { ParserDriftError } from './packageImportTypes';
import {
  createMediaslidePackageFetcher,
  parsePackageUrl,
  type MediaslideFetcher,
  type MediaslideFetcherOptions,
} from './mediaslidePackageFetcher';
import {
  countPackageListContainers,
  detectTenantSlug,
  parsePackageBook,
  parsePackageList,
  type ParsedBookFragment,
  type ParsedListEntry,
} from './mediaslidePackageParser';
import {
  evaluateRunDrift,
  MEDIASLIDE_LIST_ANCHORS,
  MEDIASLIDE_PARSER_VERSION,
} from './providerDriftDetector';

const PROVIDER_ID = 'mediaslide' as const;

const PORTFOLIO_TITLE_PATTERNS = [/^portfolio\b/i, /^book\b/i];
const POLAROID_TITLE_PATTERNS = [/^polaroids?\b/i, /^polas\b/i];

function classifyAlbum(title: string): 'portfolio' | 'polaroids' | 'extra' {
  const t = title.trim();
  if (POLAROID_TITLE_PATTERNS.some((re) => re.test(t))) return 'polaroids';
  if (PORTFOLIO_TITLE_PATTERNS.some((re) => re.test(t))) return 'portfolio';
  return 'extra';
}

export type MediaslideProviderOptions = MediaslideFetcherOptions & {
  /** Override the fetcher (mainly for tests). */
  fetcher?: MediaslideFetcher;
  /** Pro Run maximale parallele Book-Requests. Default 4. */
  bookConcurrency?: number;
};

export function createMediaslidePackageProvider(
  opts: MediaslideProviderOptions = {},
): PackageProvider {
  const fetcher = opts.fetcher ?? createMediaslidePackageFetcher(opts);
  const bookConcurrency = Math.max(1, Math.min(opts.bookConcurrency ?? 4, 8));

  function detect(input: { url: string }): boolean {
    try {
      parsePackageUrl(input.url);
      return true;
    } catch {
      return false;
    }
  }

  async function analyze(input: {
    url: string;
    signal?: AbortSignal;
    onProgress?: (s: AnalyzeProgress) => void;
    onDrift?: (drift: DriftResult) => void;
    allowDriftBypass?: boolean;
  }): Promise<ProviderImportPayload[]> {
    const { url, signal, onProgress, onDrift, allowDriftBypass } = input;

    onProgress?.({ phase: 'fetch_list', modelsTotal: 0, modelsDone: 0 });
    const listHtml = await fetcher.fetchPackageListHtml(url, signal);
    const listEntries = parsePackageList(listHtml);
    const cardsDetected = countPackageListContainers(listHtml);

    // Frühe Drift-Bewertung — schon bevor wir Books fetchen, können fehlende
    // Anchors / katastrophal niedrige Extraction-Rate einen Hard-Block auslösen.
    const earlyDrift = evaluateRunDrift({
      providerId: PROVIDER_ID,
      parserVersion: MEDIASLIDE_PARSER_VERSION,
      url,
      listHtml,
      expectedAnchors: MEDIASLIDE_LIST_ANCHORS,
      cardsDetected,
      cardsExtracted: listEntries.length,
      payloads: [],
    });
    if (earlyDrift.severity === 'hard_block' && !allowDriftBypass) {
      throw new ParserDriftError(earlyDrift);
    }

    if (listEntries.length === 0) {
      throw new Error('package_no_models');
    }

    onProgress?.({ phase: 'parse', modelsTotal: listEntries.length, modelsDone: 0 });

    const payloads: ProviderImportPayload[] = new Array(listEntries.length);

    let nextIdx = 0;
    let done = 0;

    async function worker(): Promise<void> {
      while (nextIdx < listEntries.length) {
        if (signal?.aborted) throw new Error('aborted');
        const i = nextIdx++;
        const entry = listEntries[i];
        try {
          payloads[i] = await buildPayloadForListEntry({
            entry,
            packageUrl: url,
            fetcher,
            signal,
            onProgress: (lbl) =>
              onProgress?.({
                phase: 'fetch_books',
                modelsTotal: listEntries.length,
                modelsDone: done,
                currentLabel: lbl,
              }),
          });
        } catch (e) {
          payloads[i] = buildErrorPayload(entry, e);
        } finally {
          done++;
          onProgress?.({
            phase: 'fetch_books',
            modelsTotal: listEntries.length,
            modelsDone: done,
          });
        }
      }
    }

    const slots = Math.min(bookConcurrency, listEntries.length);
    await Promise.all(Array.from({ length: slots }, worker));

    // Tenant-Slug-Validierung: wenn das List-HTML keinen erkennbaren Tenant-Slug
    // mehr enthält, ist das ein starkes Signal für Format-Drift (frühere Versionen
    // exposed `data-tenant-slug` o. ä.). Wir markieren als Warnung pro Model.
    const tenantSlug = detectTenantSlug(listHtml);
    if (!tenantSlug) {
      for (const p of payloads) {
        p.warnings = [...(p.warnings ?? []), 'tenant_slug_missing'];
      }
    }

    // Späte Drift-Bewertung mit Book-Quality.
    const lateDrift = evaluateRunDrift({
      providerId: PROVIDER_ID,
      parserVersion: MEDIASLIDE_PARSER_VERSION,
      url,
      listHtml,
      expectedAnchors: MEDIASLIDE_LIST_ANCHORS,
      cardsDetected,
      cardsExtracted: listEntries.length,
      payloads,
    });
    if (lateDrift.severity === 'hard_block' && !allowDriftBypass) {
      throw new ParserDriftError(lateDrift);
    }
    if (lateDrift.severity !== 'ok') {
      onDrift?.(lateDrift);
    }

    return payloads;
  }

  return { id: PROVIDER_ID, detect, analyze };
}

async function buildPayloadForListEntry(input: {
  entry: ParsedListEntry;
  packageUrl: string;
  fetcher: MediaslideFetcher;
  signal?: AbortSignal;
  onProgress?: (label: string) => void;
}): Promise<ProviderImportPayload> {
  const { entry, packageUrl, fetcher, signal, onProgress } = input;
  const warnings: string[] = [];

  if (!entry.defaultCategoryId) {
    return {
      externalProvider: PROVIDER_ID,
      externalId: entry.mediaSlideModelId,
      name: entry.name,
      coverImageUrl: entry.coverImageUrl ?? null,
      measurements: { height: entry.heightHintCm ?? null },
      portfolio_image_urls: [],
      polaroid_image_urls: [],
      warnings: ['no_default_album_in_card'],
    };
  }

  // 1) Default-Album holen, um Album-Katalog + Measurements zu lernen.
  onProgress?.(`${entry.name} – default album`);
  const firstBookHtml = await fetcher.fetchPackageBookFragment({
    packageUrl,
    modelPictureCategoryId: entry.defaultCategoryId,
    signal,
  });
  const firstBook = parsePackageBook(firstBookHtml);

  // Map: categoryId → images
  const imagesByCategory: Record<string, string[]> = {};
  imagesByCategory[entry.defaultCategoryId] = firstBook.imagesForCurrentCategory;

  // 2) Restliche Alben holen (alles außer dem schon geladenen).
  const remainingAlbums = firstBook.albumCatalog.filter(
    (a) => a.categoryId !== entry.defaultCategoryId,
  );
  for (const album of remainingAlbums) {
    if (signal?.aborted) throw new Error('aborted');
    onProgress?.(`${entry.name} – ${album.title}`);
    try {
      const albumHtml = await fetcher.fetchPackageBookFragment({
        packageUrl,
        modelPictureCategoryId: album.categoryId,
        signal,
      });
      const albumBook = parsePackageBook(albumHtml);
      imagesByCategory[album.categoryId] = albumBook.imagesForCurrentCategory;
    } catch (e) {
      warnings.push(`album_fetch_failed:${album.title}:${(e as Error).message ?? 'unknown'}`);
      imagesByCategory[album.categoryId] = [];
    }
  }

  return classifyAndBuildPayload({
    entry,
    book: firstBook,
    imagesByCategory,
    extraWarnings: warnings,
  });
}

function classifyAndBuildPayload(input: {
  entry: ParsedListEntry;
  book: ParsedBookFragment;
  imagesByCategory: Record<string, string[]>;
  extraWarnings: string[];
}): ProviderImportPayload {
  const { entry, book, imagesByCategory, extraWarnings } = input;
  const warnings: string[] = [...extraWarnings];

  const portfolioUrls: string[] = [];
  const polaroidUrls: string[] = [];
  const extraCounts: Record<string, number> = {};

  // Album-Katalog ist Source of Truth (er enthält alle Alben des Models).
  for (const album of book.albumCatalog) {
    const kind = classifyAlbum(album.title);
    const images = imagesByCategory[album.categoryId] ?? [];
    if (kind === 'portfolio') {
      for (const u of images) portfolioUrls.push(u);
    } else if (kind === 'polaroids') {
      for (const u of images) polaroidUrls.push(u);
    } else {
      const key = album.title.trim().toUpperCase();
      extraCounts[key] = (extraCounts[key] ?? 0) + (album.count ?? images.length);
    }
  }

  // Cross-Check Name (Listenname vs. Bookname). Mismatch → Warnung, Listenname behalten.
  if (book.name && book.name !== entry.name) {
    warnings.push(`name_mismatch:list="${entry.name}";book="${book.name}"`);
  }

  // Wenn Album-Katalog leer war (alter / minimaler Book-Render) → Default-Album als Portfolio.
  if (book.albumCatalog.length === 0 && entry.defaultCategoryId) {
    const fallbackImages = imagesByCategory[entry.defaultCategoryId] ?? [];
    for (const u of fallbackImages) portfolioUrls.push(u);
    warnings.push('album_catalog_missing');
  }

  return {
    externalProvider: PROVIDER_ID,
    externalId: entry.mediaSlideModelId,
    name: entry.name,
    coverImageUrl: entry.coverImageUrl ?? null,
    measurements: book.measurements,
    hair_color_raw: book.hair_color_raw ?? null,
    eye_color_raw: book.eye_color_raw ?? null,
    instagram: entry.instagram ?? null,
    portfolio_image_urls: portfolioUrls,
    polaroid_image_urls: polaroidUrls,
    extra_album_counts: Object.keys(extraCounts).length > 0 ? extraCounts : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

function buildErrorPayload(entry: ParsedListEntry, err: unknown): ProviderImportPayload {
  // Wenn der Book-Fetch komplett scheitert, haben wir KEINE Bilder und meist keine
  // Maße — `forceSkipReason` sorgt dafür, dass der Importer dieses Model als
  // `skipped` (statt fälschlich als `ready`) behandelt. Der List-Hint (Cover, Höhe)
  // bleibt für die UI sichtbar, ohne dass ein leeres Model committed wird.
  const hasHeight = entry.heightHintCm != null;
  return {
    externalProvider: PROVIDER_ID,
    externalId: entry.mediaSlideModelId,
    name: entry.name,
    coverImageUrl: entry.coverImageUrl ?? null,
    measurements: { height: entry.heightHintCm ?? null },
    portfolio_image_urls: [],
    polaroid_image_urls: [],
    warnings: [`book_fetch_failed:${(err as Error).message ?? 'unknown'}`],
    forceSkipReason: hasHeight ? undefined : 'book_fetch_failed',
  };
}
