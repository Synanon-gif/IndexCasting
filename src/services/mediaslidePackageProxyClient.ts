/**
 * MediaSlide Package Proxy Client
 *
 * Dünne Brücke zwischen `mediaslidePackageFetcher` (Browser) und der Edge
 * Function `mediaslide-package-proxy` (server-seitig). Wird ausschliesslich im
 * Web verwendet, weil MediaSlide keine `Access-Control-Allow-Origin`-Header
 * sendet und Direkt-Fetches damit von `https://www.index-casting.com` immer
 * mit CORS scheitern.
 *
 * KEINE Provider-spezifische Logik (kein Parsing, keine Album-Klassifikation).
 * KEINE Cookie-/State-Verwaltung — der Cookie-Jar lebt im Fetcher selbst.
 *
 * Fehler-Mapping:
 *  - HTTP-/Invocation-Fehler (Edge Function nicht erreichbar) → setzen
 *    `error: 'upstream_unreachable'`, sodass der Fetcher seine Standard-Retry-
 *    Logik (`package_unreachable`) anwenden kann.
 *  - Strukturierte Edge-Function-Fehler werden 1:1 als `error`-String
 *    durchgereicht (`unauthorized`, `not_agency_member`, `target_invalid:*`,
 *    `upstream_timeout`, `upstream_unreachable`, …). Der Fetcher übersetzt sie
 *    in stabile `package_*`-Codes für die UI.
 */

import type {
  MediaslideProxyInvoker,
  MediaslideProxyRequest,
  MediaslideProxyResponse,
} from './mediaslidePackageFetcher';

const FUNCTION_NAME = 'mediaslide-package-proxy';

/**
 * Lazy-Resolve des Supabase-Clients. `lib/supabase` zieht `expo-constants`
 * nach (Native + Web), was unter Jest ohne expo-Transformation crasht. Da die
 * Registry diesen Client beim Module-Load instanziiert, würde ein Top-Level-
 * `import` jeden Test-Lauf brechen, sobald er die Registry irgendwo lädt.
 * Lazy-Resolve eliminiert das vollständig — der Client wird erst beim ersten
 * Proxy-Call gezogen, also nie in Unit-Tests, die mit `setProvidersForTest`
 * eigene Provider injizieren.
 */
type FunctionsClient = {
  invoke: <T>(
    name: string,
    opts: { body: unknown },
  ) => Promise<{
    data: T | null;
    error: { message?: string } | null;
  }>;
};
type SupabaseLike = { functions: FunctionsClient };

let cachedClient: SupabaseLike | null = null;
function getSupabaseClient(): SupabaseLike {
  if (cachedClient) return cachedClient;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../../lib/supabase') as { supabase: SupabaseLike };
  cachedClient = mod.supabase;
  return cachedClient;
}

type EdgeOk = {
  ok: true;
  status: number;
  body: string;
  setCookie: string | null;
};
type EdgeErr = {
  ok: false;
  error: string;
};
type EdgeResponse = EdgeOk | EdgeErr;

export function createSupabaseMediaslideProxyInvoker(): MediaslideProxyInvoker {
  return async (input: MediaslideProxyRequest): Promise<MediaslideProxyResponse> => {
    if (input.signal?.aborted) {
      return { ok: false, status: 0, body: '', error: 'aborted' };
    }
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke<EdgeResponse>(FUNCTION_NAME, {
        body: {
          url: input.url,
          ...(input.cookie ? { cookie: input.cookie } : {}),
          ...(input.referer ? { referer: input.referer } : {}),
        },
      });
      if (error) {
        // `supabase.functions.invoke` packt Edge-Function-non-2xx-Antworten
        // in `error`. Wir versuchen, den Body dennoch zu lesen — die Edge
        // Function liefert auch im Fehlerfall strukturiertes JSON.
        const message = (error as { message?: string }).message ?? 'invoke_failed';
        return {
          ok: false,
          status: 0,
          body: '',
          error: mapInvokeError(message),
        };
      }
      if (!data) {
        return { ok: false, status: 0, body: '', error: 'empty_response' };
      }
      if (data.ok === true) {
        return {
          ok: true,
          status: data.status,
          body: data.body,
          setCookie: data.setCookie ?? null,
        };
      }
      return {
        ok: false,
        status: 0,
        body: '',
        error: data.error ?? 'unknown_proxy_error',
      };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        body: '',
        error: (e as Error)?.message ?? 'invoke_exception',
      };
    }
  };
}

function mapInvokeError(raw: string): string {
  // `FunctionsHttpError: Edge Function returned a non-2xx status code` etc.
  // Wir behalten den Raw-Text fuer Debugging, aber mappen die haeufigsten
  // Faelle auf unser stabiles Vokabular.
  if (/non-2xx/i.test(raw)) return 'upstream_unreachable';
  if (/network/i.test(raw)) return 'upstream_unreachable';
  if (/timeout/i.test(raw)) return 'upstream_timeout';
  return raw;
}
