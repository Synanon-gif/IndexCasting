/**
 * MediaSlide Package Fetcher
 *
 * Verantwortlich für reinen HTTP-Transport gegen `https://{tenant}.mediaslide.com`:
 * - Cookie-Jar (PHPSESSID muss zwischen Listen- und Book-Requests erhalten bleiben)
 * - Timeout + 2× Retry mit exponential-jittered Backoff
 * - Capability-Hash-Redaction in Logs (Package-URL ist Secret-ähnlich)
 * - Klarer Fehler-Code ('package_unreachable', 'package_http_error', 'package_timeout')
 *
 * Diese Datei macht KEIN Parsing und kennt keinen DB-Zugriff.
 *
 * Transport-Modi:
 *  - Default `fetchImpl` (globaler `fetch`) → für Tests / Node-Skripte / Native
 *    Apps mit erlaubten Cross-Origin-Requests.
 *  - `proxyInvoker` → für die Web-App. MediaSlide sendet KEINE
 *    `Access-Control-Allow-Origin`-Header, daher schlagen direkte Browser-Fetches
 *    von `https://www.index-casting.com` immer mit CORS fehl. Der Proxy ist die
 *    server-seitige Edge Function `mediaslide-package-proxy`, die das Request
 *    serverseitig durchführt und Body + Set-Cookie zurueckliefert. Der
 *    `TinyCookieJar` lebt weiterhin im Browser-Prozess, sodass die PHPSESSID
 *    zwischen Listen- und Book-Requests erhalten bleibt.
 */

export type MediaslideFetcher = {
  fetchPackageListHtml(packageUrl: string, signal?: AbortSignal): Promise<string>;
  fetchPackageBookFragment(input: {
    packageUrl: string;
    modelPictureCategoryId: string;
    signal?: AbortSignal;
  }): Promise<string>;
};

/**
 * Transport-Abstraktion für den server-seitigen Proxy.
 * Die Edge Function `mediaslide-package-proxy` führt den Upstream-Fetch durch
 * und gibt Body + Set-Cookie zurück. Diese Schnittstelle bleibt hier rein
 * datenförmig, damit Tests sie deterministisch simulieren können — ohne
 * `fetch`-Patching oder Supabase-Client-Mocks.
 */
export type MediaslideProxyRequest = {
  url: string;
  cookie?: string | null;
  referer?: string | null;
  signal?: AbortSignal;
};

export type MediaslideProxyResponse = {
  ok: boolean;
  /** Upstream-HTTP-Status (z. B. 200, 404, 500). Bei `ok=false` wird `error` gesetzt. */
  status: number;
  body: string;
  /** Komma-zusammengeführter Set-Cookie-Header des Upstream — kann mehrere Cookies enthalten. */
  setCookie?: string | null;
  /** Bei nicht-erfolgreichem Proxy-Aufruf (Auth-Fail, URL ungültig, Upstream-Timeout) gesetzt. */
  error?: string | null;
};

export type MediaslideProxyInvoker = (
  input: MediaslideProxyRequest,
) => Promise<MediaslideProxyResponse>;

export type MediaslideFetcherOptions = {
  /** Override `fetch` for tests / non-browser runtimes (default: globaler `fetch`). */
  fetchImpl?: typeof fetch;
  /**
   * Wenn gesetzt, werden ALLE Upstream-Requests über diesen Proxy geroutet
   * (Pflicht im Browser wegen MediaSlide-CORS). Cookie-Jar bleibt lokal —
   * der Invoker bekommt das aktuelle Cookie als Parameter und liefert ggf.
   * ein neues `setCookie` zurück, das der Jar dann übernimmt.
   */
  proxyInvoker?: MediaslideProxyInvoker;
  /** Single-request timeout in ms. Default 10 000. */
  timeoutMs?: number;
  /** Retry attempts AFTER the initial try. Default 2 → up to 3 total attempts. */
  retries?: number;
  /** Base backoff in ms; jittered. Default 400. */
  backoffMs?: number;
  /** Optional logger; defaults to a redacting console wrapper. */
  log?: (level: 'info' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>) => void;
};

const USER_AGENT = 'IndexCasting/MediaSlidePackageImporter (+https://indexcasting.com)';

/**
 * Maskiert Capability-Hash-Pfadsegmente (8+ Hex-Zeichen) in URLs für sichere Logs.
 * Beispiel: `/package/view/176/1a5f30ca/331/2a9fa1ab` → `/package/view/176/REDACTED/331/REDACTED`
 */
export function redactPackageUrl(url: string): string {
  try {
    return url.replace(/\/[0-9a-f]{8,}(?=\/|\?|$)/gi, '/REDACTED');
  } catch {
    return '[redacted-url]';
  }
}

/**
 * Strikte Validierung der Package-URL. Wirft `Error('package_url_invalid')` bei Bruch.
 * Akzeptiert NUR `https://{tenant}.mediaslide.com/package/view/{pkg}/{hash1}/{rec}/{hash2}`.
 */
export function parsePackageUrl(packageUrl: string): {
  origin: string;
  pathParts: { pkgId: string; pkgHash: string; recipientId: string; recipientHash: string };
} {
  let parsed: URL;
  try {
    parsed = new URL(packageUrl);
  } catch {
    throw new Error('package_url_invalid');
  }
  if (parsed.protocol !== 'https:') throw new Error('package_url_invalid');
  if (!parsed.hostname.endsWith('.mediaslide.com')) throw new Error('package_url_invalid');
  const m = parsed.pathname.match(/^\/package\/view\/(\d+)\/([0-9a-f]+)\/(\d+)\/([0-9a-f]+)\/?$/i);
  if (!m) throw new Error('package_url_invalid');
  return {
    origin: parsed.origin,
    pathParts: { pkgId: m[1], pkgHash: m[2], recipientId: m[3], recipientHash: m[4] },
  };
}

function defaultLog(
  level: 'info' | 'warn' | 'error',
  msg: string,
  meta?: Record<string, unknown>,
): void {
  const safeMeta = meta
    ? Object.fromEntries(
        Object.entries(meta).map(([k, v]) =>
          typeof v === 'string' && /^https?:\/\//.test(v) ? [k, redactPackageUrl(v)] : [k, v],
        ),
      )
    : undefined;
  const tag = '[mediaslidePackageFetcher]';
  if (level === 'error') console.error(tag, msg, safeMeta ?? '');
  else if (level === 'warn') console.warn(tag, msg, safeMeta ?? '');
  else console.log(tag, msg, safeMeta ?? '');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}

/**
 * Sehr schmaler Cookie-Jar — wir brauchen nur PHPSESSID rüberzureichen.
 * Speichert pro Origin den Set-Cookie-Wert ungeparst (ohne Attribute).
 */
class TinyCookieJar {
  private store = new Map<string, string>();

  setFromHeader(origin: string, setCookieHeader: string | null): void {
    if (!setCookieHeader) return;
    const cookies = setCookieHeader
      .split(/,(?=[^;]+=)/)
      .map((c) => c.split(';')[0]?.trim())
      .filter((c): c is string => Boolean(c) && c.includes('='));
    if (cookies.length === 0) return;
    const merged = cookies.join('; ');
    const existing = this.store.get(origin);
    this.store.set(origin, existing ? `${existing}; ${merged}` : merged);
  }

  header(origin: string): string | null {
    return this.store.get(origin) ?? null;
  }
}

export function createMediaslidePackageFetcher(
  opts: MediaslideFetcherOptions = {},
): MediaslideFetcher {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const proxyInvoker = opts.proxyInvoker ?? null;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retries = opts.retries ?? 2;
  const backoffMs = opts.backoffMs ?? 400;
  const log = opts.log ?? defaultLog;
  const jar = new TinyCookieJar();

  /**
   * Result-Typ für eine einzelne Upstream-Anfrage. `body` und `status` werden
   * sowohl vom direkten Fetch- als auch vom Proxy-Pfad geliefert. `setCookie`
   * wird in beiden Pfaden in den lokalen Jar gespiegelt.
   */
  type UpstreamResult = { status: number; body: string; setCookie: string | null };

  /**
   * Direkter Fetch-Pfad (Tests / Native). Wird im Web NICHT verwendet — dort
   * setzen wir `proxyInvoker`, weil MediaSlide keine CORS-Header sendet.
   */
  async function doDirectFetch(
    url: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<UpstreamResult> {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: ctrl.signal,
      });
      const setCookie = (res.headers as Headers).get?.('set-cookie') ?? null;
      const body = await res.text();
      return { status: res.status, body, setCookie };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Proxy-Pfad (Web). Übergibt URL + Cookie + Referer an die Edge Function;
   * die Edge Function macht das Upstream-Request server-seitig (kein CORS) und
   * liefert Body + Set-Cookie zurück. Proxy-Fehler (`unauthorized`,
   * `not_agency_member`, `target_invalid`, `upstream_timeout`,
   * `upstream_unreachable`) werden in unsere stabilen Fehler-Codes
   * übersetzt — die UI versteht weiterhin nur `package_*`.
   */
  async function doProxyFetch(
    url: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<UpstreamResult> {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await proxyInvoker!({
        url,
        cookie: headers.Cookie ?? null,
        referer: headers.Referer ?? null,
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const code = res.error ?? 'package_unreachable';
        if (code === 'upstream_timeout') throw new Error('package_timeout');
        if (code === 'upstream_unreachable') throw new Error('package_unreachable');
        if (code === 'unauthorized' || code === 'not_agency_member') {
          throw new Error('package_proxy_forbidden');
        }
        if (code.startsWith('target_invalid')) {
          throw new Error('package_url_invalid');
        }
        if (code === 'service_misconfigured') {
          throw new Error('package_proxy_misconfigured');
        }
        throw new Error(`package_proxy_error:${code}`);
      }
      return {
        status: res.status,
        body: res.body ?? '',
        setCookie: res.setCookie ?? null,
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Vereinheitlicht direkten und Proxy-Pfad inkl. Retry/Backoff. Identische
   * Status-Klassifikation wie zuvor: 4xx (außer 408/429) sind nicht-retrybar,
   * 5xx + 408 + 429 + Netzwerkfehler werden mit Backoff erneut versucht.
   */
  async function doRequestWithRetry(
    url: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<UpstreamResult> {
    const origin = new URL(url).origin;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = proxyInvoker
          ? await doProxyFetch(url, headers, signal)
          : await doDirectFetch(url, headers, signal);
        jar.setFromHeader(origin, result.setCookie);
        if (result.status >= 200 && result.status < 300) {
          return result;
        }
        if (
          result.status >= 400 &&
          result.status < 500 &&
          result.status !== 408 &&
          result.status !== 429
        ) {
          throw new Error(`package_http_error:${result.status}`);
        }
        lastErr = new Error(`package_http_error:${result.status}`);
      } catch (e) {
        if (signal?.aborted) throw new Error('aborted');
        if ((e as Error).name === 'AbortError') {
          lastErr = new Error('package_timeout');
        } else {
          lastErr = e;
        }
        const msg = (lastErr as Error).message ?? '';
        // Nicht-retrybare Fehler: 4xx (ausser 408/429), URL invalid, Forbidden, Misconfigured.
        if (
          (msg.startsWith('package_http_error:4') &&
            !msg.endsWith(':408') &&
            !msg.endsWith(':429')) ||
          msg === 'package_url_invalid' ||
          msg === 'package_proxy_forbidden' ||
          msg === 'package_proxy_misconfigured' ||
          msg.startsWith('package_proxy_error:')
        ) {
          throw lastErr;
        }
      }
      if (attempt < retries) {
        const jitter = Math.random() * backoffMs;
        const wait = backoffMs * 2 ** attempt + jitter;
        log('warn', 'retrying', { url: redactPackageUrl(url), attempt: attempt + 1, wait });
        await sleep(wait, signal);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('package_unreachable');
  }

  async function fetchPackageListHtml(packageUrl: string, signal?: AbortSignal): Promise<string> {
    const { origin } = parsePackageUrl(packageUrl);
    log('info', 'fetch list', { url: packageUrl });
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en;q=1.0',
    };
    const cookie = jar.header(origin);
    if (cookie) headers.Cookie = cookie;
    const result = await doRequestWithRetry(packageUrl, headers, signal);
    return result.body;
  }

  async function fetchPackageBookFragment(input: {
    packageUrl: string;
    modelPictureCategoryId: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const { origin, pathParts } = parsePackageUrl(input.packageUrl);
    if (!/^\d+$/.test(input.modelPictureCategoryId)) {
      throw new Error('package_category_invalid');
    }
    const url = `${origin}/package/viewBook?package_id=${pathParts.pkgId}&hash=${pathParts.pkgHash}&package_recipient_id=${pathParts.recipientId}&recipient_hash=${pathParts.recipientHash}&model_picture_category_id=${input.modelPictureCategoryId}`;
    log('info', 'fetch book', {
      url,
      categoryId: input.modelPictureCategoryId,
    });
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en;q=1.0',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: input.packageUrl,
    };
    const cookie = jar.header(origin);
    if (cookie) headers.Cookie = cookie;
    const result = await doRequestWithRetry(url, headers, input.signal);
    return result.body;
  }

  return { fetchPackageListHtml, fetchPackageBookFragment };
}
