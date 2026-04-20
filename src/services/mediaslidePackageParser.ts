/**
 * MediaSlide Package Parser — pure & deterministic.
 *
 * Input: HTML-Strings (Listen-Seite + Book-Fragmente).
 * Output: strukturierte Daten (Cards, Books, gemergeter Package-Snapshot).
 *
 * Bewusst keine externe HTML-Library: wir verwenden gezielte RegExps gegen die
 * stabilen Anker (`data-model-id`, `translate="no"`, `.measurementElement`,
 * GCS-Pfad-Pattern). Damit bleibt der Parser unabhängig von cheerio/linkedom
 * und schnell genug für 50–100 Models.
 *
 * KEIN HTTP, KEIN DB, KEIN STATE. 100 % deterministisch und unit-testbar.
 */

import { redactPackageUrl } from './mediaslidePackageFetcher';

export type ParsedListEntry = {
  /** MediaSlide-stabile Model-ID (z. B. "256"). Pflicht. */
  mediaSlideModelId: string;
  /** Package-Model-ID (per Package eindeutig, NICHT als Identität verwenden). */
  packageModelId?: string;
  /** Default-Album-ID, in das `#book-...` zeigt. Erster Einstieg für Book-Fetch. */
  defaultCategoryId?: string;
  name: string;
  coverImageUrl?: string | null;
  instagram?: string | null;
  /** "Soft"-Hinweis aus der Listen-Karte (z. B. 187cm). Wird vom Book-Fetch überschrieben. */
  heightHintCm?: number | null;
};

export type ParsedAlbumLink = {
  categoryId: string;
  /** Album-Titel in Provider-Original (z. B. "PORTFOLIO", "POLAROIDS", "DIGITALS"). */
  title: string;
  /** Optional: Bild-Anzahl, wie vom Provider in `(X)` ausgewiesen. */
  count?: number | null;
};

export type ParsedBookFragment = {
  /** Cross-Check Name (kann von Listenname leicht abweichen — Schreibweise/Diakritika). */
  name?: string | null;
  measurements: {
    height?: number | null;
    bust?: number | null;
    waist?: number | null;
    hips?: number | null;
    chest?: number | null;
    legs_inseam?: number | null;
    shoe_size?: number | null;
  };
  hair_color_raw?: string | null;
  eye_color_raw?: string | null;
  /** Album-Katalog dieses Models (alle Alben, nicht nur das gerade angezeigte). */
  albumCatalog: ParsedAlbumLink[];
  /** Bild-URLs nur für DIESES eine Album (das per `model_picture_category_id` geladen wurde). */
  imagesForCurrentCategory: string[];
};

export type ParsedPackage = {
  /** Tenant-Slug aus dem ersten beobachteten GCS-URL, z. B. "hausofhay". Nur informativ. */
  tenantSlug?: string | null;
  models: Array<{
    list: ParsedListEntry;
    book?: ParsedBookFragment;
    /** Pro Album-ID die Bilder, die wir dafür gezogen haben. */
    imagesByCategory: Record<string, string[]>;
  }>;
};

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export function parsePackageList(html: string): ParsedListEntry[] {
  const cards = splitOn(html, /<div\s+id="packageModel_(\d+)"[^>]*class="packageModel"[^>]*>/gi);
  const entries: ParsedListEntry[] = [];
  for (const { capture: packageModelId, body } of cards) {
    const mediaSlideModelId = extractMediaSlideModelId(body);
    if (!mediaSlideModelId) continue;
    const name = extractListName(body);
    if (!name) continue;
    const defaultCategoryId = extractDefaultCategoryId(body);
    const coverImageUrl = extractCoverImageUrl(body);
    const instagram = extractInstagramHandle(body);
    const heightHintCm = extractHeightHintCm(body);
    entries.push({
      mediaSlideModelId,
      packageModelId,
      defaultCategoryId,
      name,
      coverImageUrl,
      instagram,
      heightHintCm,
    });
  }
  return entries;
}

export function parsePackageBook(html: string): ParsedBookFragment {
  return {
    name: extractBookName(html),
    measurements: extractMeasurementsFromBook(html),
    hair_color_raw: extractMeasurementText(html, ['Hair', 'Cheveux', 'Capelli', 'Haare']),
    eye_color_raw: extractMeasurementText(html, ['Eyes', 'Yeux', 'Occhi', 'Augen']),
    albumCatalog: extractAlbumCatalog(html),
    imagesForCurrentCategory: extractBookImages(html),
  };
}

/** Tenant-Slug aus erster GCS-URL extrahieren (informativ). */
export function detectTenantSlug(html: string): string | null {
  const m = html.match(
    /https:\/\/mediaslide-europe\.storage\.googleapis\.com\/([a-z0-9_-]+)\/pictures\//i,
  );
  return m?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Helpers — list card extraction
// ---------------------------------------------------------------------------

function splitOn(
  html: string,
  startRe: RegExp,
): Array<{ capture: string; body: string; startIdx: number }> {
  const out: Array<{ capture: string; body: string; startIdx: number }> = [];
  const re = new RegExp(
    startRe.source,
    startRe.flags.includes('g') ? startRe.flags : `${startRe.flags}g`,
  );
  const matches: Array<{ capture: string; idx: number; len: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    matches.push({ capture: m[1] ?? '', idx: m.index, len: m[0].length });
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  for (let i = 0; i < matches.length; i++) {
    const startIdx = matches[i].idx + matches[i].len;
    const endIdx = i + 1 < matches.length ? matches[i + 1].idx : html.length;
    out.push({ capture: matches[i].capture, body: html.slice(startIdx, endIdx), startIdx });
  }
  return out;
}

function extractMediaSlideModelId(cardHtml: string): string | null {
  const m = cardHtml.match(/data-model-id="(\d+)"/i);
  return m?.[1] ?? null;
}

function extractListName(cardHtml: string): string | null {
  // <div class="modelName" translate="no"> ... </div>
  const m = cardHtml.match(/<div[^>]*class="modelName"[^>]*translate="no"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return null;
  return decodeAndTrim(m[1]);
}

function extractDefaultCategoryId(cardHtml: string): string | undefined {
  const m = cardHtml.match(/href="#book-(\d+)"/i);
  return m?.[1];
}

function extractCoverImageUrl(cardHtml: string): string | null {
  const dataOriginal = cardHtml.match(/data-original="(https:\/\/[^"]+\/pictures\/[^"]+)"/i);
  if (dataOriginal) return dataOriginal[1];
  const dataLazy = cardHtml.match(/data-lazy="(https:\/\/[^"]+\/pictures\/[^"]+)"/i);
  return dataLazy?.[1] ?? null;
}

function extractInstagramHandle(cardHtml: string): string | null {
  const m = cardHtml.match(/href=['"]https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._-]+)/i);
  return m?.[1] ?? null;
}

function extractHeightHintCm(cardHtml: string): number | null {
  const m = cardHtml.match(/(\d{2,3})\s*cm/i);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Helpers — book fragment extraction
// ---------------------------------------------------------------------------

function extractBookName(html: string): string | null {
  const m = html.match(/<div[^>]*class="bookMenuName"[^>]*translate="no"[^>]*>([\s\S]*?)<\/div>/i);
  if (m) return decodeAndTrim(m[1]);
  const m2 = html.match(
    /<div[^>]*class="modelBookLogoName"[^>]*translate="no"[^>]*>([\s\S]*?)<\/div>/i,
  );
  return m2 ? decodeAndTrim(m2[1]) : null;
}

const MEASUREMENT_LABELS: Record<keyof ParsedBookFragment['measurements'], string[]> = {
  height: ['Height', 'Taille', 'Altezza', 'Estatura', 'Größe', 'Grosse'],
  bust: ['Bust', 'Buste', 'Pecho', 'Busen', 'Büste'],
  waist: ['Waist', 'Tour de taille', 'Cintura', 'Vita'],
  hips: ['Hips', 'Hanches', 'Cadera', 'Fianchi', 'Hüften', 'Hueften'],
  chest: ['Chest', 'Poitrine', 'Petto', 'Brust'],
  legs_inseam: ['Inseam', 'Entrejambe', 'Cavallo', 'Schritt'],
  shoe_size: ['Shoes', 'Chaussures', 'Scarpe', 'Schuhe', 'Shoe', 'Zapatos'],
};

function extractMeasurementsFromBook(html: string): ParsedBookFragment['measurements'] {
  const result: ParsedBookFragment['measurements'] = {};
  const elements = extractMeasurementElements(html);
  if (elements.length === 0) return result;

  // Strategie 1: Label-basiertes Matching (Multi-Sprache).
  for (const el of elements) {
    const key = matchMeasurementKey(el.title);
    if (!key) continue;
    if (key === 'shoe_size') {
      result.shoe_size = parseShoeEu(el.body);
    } else {
      result[key] = parseCmValue(el.body);
    }
  }

  // Strategie 2 (Fallback): wenn KEIN Wert per Label gemappt wurde,
  // versuche Positions-Reihenfolge (typisch: height, chest, waist, hips, inseam, hair, eyes, shoes).
  const anyMeasurement = Object.values(result).some((v) => v != null);
  if (!anyMeasurement) {
    const cmEls = elements
      .map((el) => ({ el, value: parseCmValue(el.body) }))
      .filter((x): x is { el: (typeof elements)[number]; value: number } => x.value != null);
    const positions: Array<keyof ParsedBookFragment['measurements']> = [
      'height',
      'chest',
      'waist',
      'hips',
      'legs_inseam',
    ];
    for (let i = 0; i < positions.length && i < cmEls.length; i++) {
      result[positions[i]] = cmEls[i].value;
    }
    const shoesEl = elements.find((el) => /\d+(?:[.,]\d+)?\s*eu/i.test(stripTags(el.body)));
    if (shoesEl) result.shoe_size = parseShoeEu(shoesEl.body);
  }

  return result;
}

function extractMeasurementElements(html: string): Array<{ title: string; body: string }> {
  const re = /<div[^>]*class="measurementElement"[^>]*>([\s\S]*?)<\/div>/gi;
  const out: Array<{ title: string; body: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const inner = m[1];
    const titleMatch = inner.match(
      /<span[^>]*class="measurementTitle"[^>]*>([\s\S]*?)<\/span>([\s\S]*)$/i,
    );
    if (titleMatch) {
      out.push({ title: decodeAndTrim(titleMatch[1]), body: titleMatch[2] });
    } else {
      out.push({ title: '', body: inner });
    }
  }
  return out;
}

function matchMeasurementKey(rawTitle: string): keyof ParsedBookFragment['measurements'] | null {
  const t = rawTitle.toLowerCase();
  for (const key of Object.keys(MEASUREMENT_LABELS) as Array<
    keyof ParsedBookFragment['measurements']
  >) {
    if (
      MEASUREMENT_LABELS[key].some(
        (lbl) => t === lbl.toLowerCase() || t.startsWith(lbl.toLowerCase()),
      )
    ) {
      return key;
    }
  }
  return null;
}

function parseCmValue(html: string): number | null {
  const m = html.match(/<span[^>]*class="measurementEu"[^>]*>(\d+)(?:[.,](\d+))?\s*<span/i);
  if (m) {
    const intPart = Number(m[1]);
    const frac = m[2] ? Number(`0.${m[2]}`) : 0;
    return Math.round(intPart + frac);
  }
  const m2 = html.match(/(\d{2,3})\s*cm/i);
  return m2 ? Number(m2[1]) : null;
}

function parseShoeEu(html: string): number | null {
  // Shoes: prefer first .measurementEu starting with digits + "eu"
  const m = html.match(/<span[^>]*class="measurementEu"[^>]*>(\d+(?:[.,]\d+)?)\s*eu<\/span>/i);
  if (m) {
    return Number(m[1].replace(',', '.'));
  }
  // Fallback: any number followed by "eu" anywhere
  const m2 = html.match(/(\d+(?:[.,]\d+)?)\s*eu/i);
  return m2 ? Number(m2[1].replace(',', '.')) : null;
}

function extractMeasurementText(html: string, labelCandidates: string[]): string | null {
  // Picks plain text after `<span class="measurementTitle">{label}</span>`
  const elements = extractMeasurementElements(html);
  for (const el of elements) {
    if (
      labelCandidates.some(
        (lbl) =>
          el.title.toLowerCase() === lbl.toLowerCase() ||
          el.title.toLowerCase().startsWith(lbl.toLowerCase()),
      )
    ) {
      const text = decodeAndTrim(stripTags(el.body));
      if (text.length === 0) return null;
      return text;
    }
  }
  return null;
}

function extractAlbumCatalog(html: string): ParsedAlbumLink[] {
  const out: ParsedAlbumLink[] = [];
  // Wir matchen den ganzen `<a ... href="#book-X">…</a>`-Block (eindeutig durch `</a>`)
  // und extrahieren albumCounter + title separat — das umgeht das Problem, dass das
  // erste `</span>` der inneren `albumCounter`-Spans gehört.
  const re = /<a[^>]*href="#book-(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(html))) {
    const categoryId = m[1];
    const inner = m[2];
    if (!/class="(?:menuSelected|menuUnselected)"/i.test(inner)) continue;
    if (seen.has(categoryId)) continue;
    seen.add(categoryId);
    const counterMatch = inner.match(
      /<span[^>]*class="albumCounter"[^>]*>\s*\((\d+)\)\s*<\/span>/i,
    );
    const titleRaw = decodeAndTrim(stripTags(inner));
    const title = titleRaw.replace(/\s*\(\d+\)\s*$/, '').trim();
    if (!title) continue;
    out.push({
      categoryId,
      title,
      count: counterMatch ? Number(counterMatch[1]) : null,
    });
  }
  return out;
}

function extractBookImages(html: string): string[] {
  // Sammeln aus DIV.modelBookPicture(First)? > IMG.portrait.
  // Reihenfolge: erstes Bild hat `src=`, alle weiteren `data-lazy=`.
  // Wir extrahieren in DOM-Reihenfolge.
  const out: string[] = [];
  const seen = new Set<string>();
  const re =
    /<div[^>]*class="modelBookPicture(?:First)?"[^>]*>[\s\S]*?<img[^>]*class="portrait"[^>]*?(?:\s(?:src|data-lazy))="(https:\/\/[^"]+\/pictures\/[^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = m[1];
    if (isPlaceholderImage(url)) continue;
    const dedupKey = imageDedupKey(url);
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    out.push(url);
  }
  // Fallback: wenn pattern oben nichts liefert (z. B. zusätzliches Markup), ziehe
  // ALLE pictures-URLs in DOM-Reihenfolge UND filtere Profilbild-Cover heraus.
  if (out.length === 0) {
    const reAll =
      /https:\/\/[^"'\s]+\/pictures\/\d+\/\d+\/(?:large|profile|thumb)-\d+-[0-9a-f]{32}\.jpg(?:\?[^"'\s]*)?/gi;
    let mm: RegExpExecArray | null;
    while ((mm = reAll.exec(html))) {
      const url = mm[0];
      const dedupKey = imageDedupKey(url);
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      out.push(url);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

/** Stabiler Dedup-Key aus der URL: `{modelId}/{categoryId}/{md5}` (ohne Größe und ohne Cache-Buster). */
export function imageDedupKey(url: string): string {
  const m = url.match(/\/pictures\/(\d+)\/(\d+)\/(?:profile|large|thumb)-\d+-([0-9a-f]{32})\.jpg/i);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  return url.split('?')[0];
}

function isPlaceholderImage(url: string): boolean {
  return url.includes('no-picture.png') || url.includes('static-ms-eu.mediaslide.com/images');
}

// ---------------------------------------------------------------------------
// HTML decode / strip
// ---------------------------------------------------------------------------

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function decodeAndTrim(s: string): string {
  return decodeHtmlEntities(stripTags(s)).replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

// ---------------------------------------------------------------------------
// Tiny utility re-export — keeps callers from pulling fetcher just for redact
// ---------------------------------------------------------------------------

export { redactPackageUrl };
