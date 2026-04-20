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
 * Sie ist über `fetchImpl` test-bar (Default: globaler `fetch`, in Tests injizierbar).
 */

export type MediaslideFetcher = {
  fetchPackageListHtml(packageUrl: string, signal?: AbortSignal): Promise<string>;
  fetchPackageBookFragment(input: {
    packageUrl: string;
    modelPictureCategoryId: string;
    signal?: AbortSignal;
  }): Promise<string>;
};

export type MediaslideFetcherOptions = {
  /** Override `fetch` for tests. */
  fetchImpl?: typeof fetch;
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
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retries = opts.retries ?? 2;
  const backoffMs = opts.backoffMs ?? 400;
  const log = opts.log ?? defaultLog;
  const jar = new TinyCookieJar();

  async function doFetchWithRetry(
    url: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      signal?.addEventListener('abort', onAbort);
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        const origin = new URL(url).origin;
        const setCookie =
          (res.headers as Headers).get?.('set-cookie') ??
          (res.headers as unknown as { get?: (k: string) => string | null }).get?.('set-cookie') ??
          null;
        jar.setFromHeader(origin, setCookie ?? null);
        if (res.ok) return res;
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          throw new Error(`package_http_error:${res.status}`);
        }
        lastErr = new Error(`package_http_error:${res.status}`);
      } catch (e) {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) throw new Error('aborted');
        if ((e as Error).name === 'AbortError') {
          lastErr = new Error('package_timeout');
        } else {
          lastErr = e;
        }
        if (
          (lastErr as Error).message?.startsWith('package_http_error:4') &&
          !(lastErr as Error).message.endsWith(':408') &&
          !(lastErr as Error).message.endsWith(':429')
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
    const res = await doFetchWithRetry(
      packageUrl,
      {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en;q=1.0',
          ...(jar.header(origin) ? { Cookie: jar.header(origin) as string } : {}),
        },
        redirect: 'follow',
      },
      signal,
    );
    return await res.text();
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
    const res = await doFetchWithRetry(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en;q=1.0',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: input.packageUrl,
          ...(jar.header(origin) ? { Cookie: jar.header(origin) as string } : {}),
        },
        redirect: 'follow',
      },
      input.signal,
    );
    return await res.text();
  }

  return { fetchPackageListHtml, fetchPackageBookFragment };
}
