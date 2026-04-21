/**
 * MediaSlide Package Fetcher — Proxy-Transport-Tests.
 *
 * Diese Tests beweisen, dass der Fetcher unabhaengig von `fetch` arbeiten kann,
 * sobald ein `proxyInvoker` gesetzt ist. Hintergrund: MediaSlide sendet keinen
 * `Access-Control-Allow-Origin`-Header, daher schlaegt jeder direkte Browser-
 * Fetch von `https://www.index-casting.com` mit CORS fehl. Der Web-Build muss
 * deshalb zwingend ueber die Edge Function `mediaslide-package-proxy` gehen.
 *
 * Was hier abgesichert wird:
 *  - `proxyInvoker` wird statt `fetch` aufgerufen, wenn gesetzt.
 *  - Cookie-Jar lebt im Fetcher: nach einem `setCookie` aus der ersten Antwort
 *    wird die naechste Anfrage MIT dem entsprechenden `Cookie`-Header an den
 *    Proxy geschickt (PHPSESSID-Sitzungsbruecke zwischen Listen- und Book-
 *    Requests).
 *  - Strukturierte Edge-Function-Fehler (`unauthorized`, `target_invalid:*`,
 *    `upstream_timeout`, `upstream_unreachable`) werden in stabile
 *    `package_*`-Codes uebersetzt.
 *  - Retry/Backoff funktioniert auch im Proxy-Pfad bei 5xx und Netzwerkfehlern.
 *  - 4xx (ausser 408/429) werden NICHT retried.
 */

import {
  createMediaslidePackageFetcher,
  type MediaslideProxyInvoker,
  type MediaslideProxyResponse,
} from '../mediaslidePackageFetcher';

const VALID_URL = 'https://hausofhay.mediaslide.com/package/view/176/1a5f30ca/331/2a9fa1ab';

describe('mediaslidePackageFetcher — proxy transport', () => {
  it('routes through proxyInvoker instead of fetch when set', async () => {
    const invoker = jest.fn<Promise<MediaslideProxyResponse>, Parameters<MediaslideProxyInvoker>>(
      async () => ({ ok: true, status: 200, body: '<html>list</html>', setCookie: null }),
    );

    // Hard fail if `fetch` is called — proves the direct path is bypassed.
    const fetchSpy = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () => {
      throw new Error('direct fetch must NOT be called when proxyInvoker is set');
    });

    const fetcher = createMediaslidePackageFetcher({
      proxyInvoker: invoker,
      fetchImpl: fetchSpy as unknown as typeof fetch,
      retries: 0,
      timeoutMs: 1_000,
      log: () => {},
    });

    const html = await fetcher.fetchPackageListHtml(VALID_URL);

    expect(html).toBe('<html>list</html>');
    expect(invoker).toHaveBeenCalledTimes(1);
    expect(invoker.mock.calls[0][0].url).toBe(VALID_URL);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('persists Set-Cookie from list call into Cookie header on book call (PHPSESSID bridge)', async () => {
    const calls: Array<{ url: string; cookie: string | null | undefined }> = [];
    const invoker: MediaslideProxyInvoker = async (input) => {
      calls.push({ url: input.url, cookie: input.cookie });
      if (input.url === VALID_URL) {
        return {
          ok: true,
          status: 200,
          body: '<html>list</html>',
          setCookie: 'PHPSESSID=abc123; Path=/; Max-Age=604800',
        };
      }
      return { ok: true, status: 200, body: '<html>book</html>', setCookie: null };
    };

    const fetcher = createMediaslidePackageFetcher({
      proxyInvoker: invoker,
      retries: 0,
      log: () => {},
    });

    await fetcher.fetchPackageListHtml(VALID_URL);
    await fetcher.fetchPackageBookFragment({
      packageUrl: VALID_URL,
      modelPictureCategoryId: '674',
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].cookie).toBeFalsy();
    expect(calls[1].url).toMatch(/\/package\/viewBook\?package_id=176/);
    expect(calls[1].cookie).toBe('PHPSESSID=abc123');
  });

  it('passes Referer (the original packageUrl) on book calls but not on the list call', async () => {
    const referers: Array<string | null | undefined> = [];
    const invoker: MediaslideProxyInvoker = async (input) => {
      referers.push(input.referer);
      return { ok: true, status: 200, body: '', setCookie: null };
    };

    const fetcher = createMediaslidePackageFetcher({
      proxyInvoker: invoker,
      retries: 0,
      log: () => {},
    });

    await fetcher.fetchPackageListHtml(VALID_URL);
    await fetcher.fetchPackageBookFragment({
      packageUrl: VALID_URL,
      modelPictureCategoryId: '674',
    });

    expect(referers[0]).toBeFalsy();
    expect(referers[1]).toBe(VALID_URL);
  });

  it('translates upstream_timeout -> package_timeout and is non-retryable for hard auth fails', async () => {
    const timeoutInvoker: MediaslideProxyInvoker = async () => ({
      ok: false,
      status: 0,
      body: '',
      error: 'upstream_timeout',
    });
    const timeoutFetcher = createMediaslidePackageFetcher({
      proxyInvoker: timeoutInvoker,
      retries: 0,
      log: () => {},
    });
    await expect(timeoutFetcher.fetchPackageListHtml(VALID_URL)).rejects.toThrow('package_timeout');

    const unauthorizedInvoker = jest.fn<
      Promise<MediaslideProxyResponse>,
      Parameters<MediaslideProxyInvoker>
    >(async () => ({ ok: false, status: 0, body: '', error: 'unauthorized' }));
    const unauthFetcher = createMediaslidePackageFetcher({
      proxyInvoker: unauthorizedInvoker,
      retries: 3,
      log: () => {},
    });
    await expect(unauthFetcher.fetchPackageListHtml(VALID_URL)).rejects.toThrow(
      'package_proxy_forbidden',
    );
    // Forbidden MUST NOT retry — same auth context would just fail again.
    expect(unauthorizedInvoker).toHaveBeenCalledTimes(1);
  });

  it('retries 5xx upstream responses up to `retries` times in proxy mode', async () => {
    let attempts = 0;
    const invoker: MediaslideProxyInvoker = async () => {
      attempts += 1;
      if (attempts < 3) {
        return { ok: true, status: 503, body: '', setCookie: null };
      }
      return { ok: true, status: 200, body: '<html>ok</html>', setCookie: null };
    };
    const fetcher = createMediaslidePackageFetcher({
      proxyInvoker: invoker,
      retries: 2,
      backoffMs: 1,
      log: () => {},
    });
    const html = await fetcher.fetchPackageListHtml(VALID_URL);
    expect(html).toBe('<html>ok</html>');
    expect(attempts).toBe(3);
  });

  it('does NOT retry 4xx (except 408/429) in proxy mode', async () => {
    const invoker = jest.fn<Promise<MediaslideProxyResponse>, Parameters<MediaslideProxyInvoker>>(
      async () => ({ ok: true, status: 404, body: '', setCookie: null }),
    );
    const fetcher = createMediaslidePackageFetcher({
      proxyInvoker: invoker,
      retries: 3,
      backoffMs: 1,
      log: () => {},
    });
    await expect(fetcher.fetchPackageListHtml(VALID_URL)).rejects.toThrow('package_http_error:404');
    expect(invoker).toHaveBeenCalledTimes(1);
  });
});
