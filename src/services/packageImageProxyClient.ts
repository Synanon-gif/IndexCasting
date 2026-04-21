/**
 * Package Image Proxy Client (Web only)
 *
 * Liefert ein `fetch`-kompatibles Implementation, das Bild-Downloads ueber
 * die Edge Function `package-image-proxy` routet. Ohne diesen Proxy
 * scheitert der Phase-2-Bild-Mirror im Browser an CORS, weil der Mediaslide-
 * GCS-Bucket (`mediaslide-europe.storage.googleapis.com`) keinen
 * `Access-Control-Allow-Origin` sendet → `download_network` fuer alle Bilder.
 *
 * Provider-Neutralitaet bleibt gewahrt: `packageImagePersistence` weiss
 * NICHTS von diesem Modul. Es bekommt einfach einen `fetchImpl`, der wie
 * `globalThis.fetch` aussieht — sieht eine Response mit dem Original-
 * MIME-Type und dem Bild-Body, und behandelt sie 1:1 wie einen Direkt-Fetch.
 *
 * Warum NICHT `supabase.functions.invoke()`?
 *  - `invoke()` ist auf JSON ausgelegt, der Response-Body waere base64-
 *    gewrapped → +33 % Overhead pro Bild + zusaetzlicher Decode-Schritt.
 *  - Ein direkter `fetch()` mit Bearer-Token gibt uns binary-streamed
 *    Body und unveraendertes `content-type`-Header durch.
 *
 * Wir geben absichtlich KEINE Cookies / Auth fuer den Upstream weiter —
 * der Provider-CDN behandelt uns wie einen anonymen Client (gespiegelt aus
 * `packageImagePersistence.downloadImageBytes`). Auth ist hier nur zwischen
 * Browser ↔ Edge Function.
 */

import { supabaseUrl, supabaseAnonKey } from '../config/env';

const FUNCTION_NAME = 'package-image-proxy';

/**
 * Lazy-Resolver fuer den Supabase-Client. Identisches Muster wie in
 * `mediaslidePackageProxyClient.ts`: Top-Level-Imports von `lib/supabase`
 * ziehen `expo-constants` nach und brechen Jest-Tests, die diesen Pfad
 * indirekt laden (z. B. ueber den providerRegistry).
 */
type AuthClient = {
  getSession: () => Promise<{
    data: { session: { access_token?: string | null } | null };
    error: { message?: string } | null;
  }>;
};
type SupabaseLike = { auth: AuthClient };

let cachedClient: SupabaseLike | null = null;
function getSupabaseClient(): SupabaseLike {
  if (cachedClient) return cachedClient;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../../lib/supabase') as { supabase: SupabaseLike };
  cachedClient = mod.supabase;
  return cachedClient;
}

/**
 * Erstellt einen `fetch`-kompatiblen Implementer, der GET-Requests an
 * Provider-CDNs durch die `package-image-proxy`-Edge-Function tunnelt.
 *
 * - Akzeptiert NUR GET-Requests; alles andere wirft (defensiv, da
 *   `packageImagePersistence` ohnehin nur GETs macht).
 * - Forwarded den `signal` aus dem Init, sodass Abort/Timeout korrekt
 *   greift (Persistenz-Pipeline setzt eigene 15-s-Timeouts on top).
 * - Liefert die Edge-Function-Response 1:1 zurueck. Body bleibt binaer.
 */
export function createSupabasePackageImageFetchImpl(): typeof fetch {
  const proxyUrl = `${supabaseUrl}/functions/v1/${FUNCTION_NAME}`;

  return async function packageImageProxyFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'GET') {
      // Persistenz-Pipeline macht ausschliesslich GETs. Andere Methoden
      // wuerden auf Edge-Function-Seite eh mit 405 rauskommen — wir
      // verfehlen frueh und ehrlich.
      throw new Error(`package-image-proxy supports GET only, got ${method}`);
    }

    let token: string | null = null;
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        // Auth-Fehler an dieser Stelle wuerde die Persistenz mit
        // `download_network` markieren — sichtbar als Warning im Outcome.
        throw new Error(`auth_session_failed:${error.message ?? 'unknown'}`);
      }
      token = data.session?.access_token ?? null;
    } catch (e) {
      throw new Error(`auth_session_exception:${(e as Error)?.message ?? 'unknown'}`);
    }
    if (!token) {
      throw new Error('auth_no_session');
    }

    return fetch(proxyUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
        Accept: 'image/*',
      },
      body: JSON.stringify({ url }),
      signal: init?.signal,
      // Wir folgen Edge-Function-internen Redirects nicht selbst — die
      // Edge Function macht `redirect: 'follow'` upstream und liefert den
      // finalen Body. Browser-seitig ist das hier ein klarer POST → 200.
      redirect: 'manual',
    });
  };
}
