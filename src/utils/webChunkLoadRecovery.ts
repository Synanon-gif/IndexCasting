/**
 * Web-only: recover from stale split-chunks after deploy when a dynamic import
 * receives HTML (SPA fallback) instead of JS — SyntaxError "Unexpected token '<'".
 * One automatic reload per session, then a plain alert (no loop).
 */

import { Platform } from 'react-native';
import { uiCopy } from '../constants/uiCopy';

const SESSION_KEY = 'ic_web_stale_chunk_reload_v1';

/** Exported for unit tests — detects HTML-as-JS / stale chunk / Metro unknown module. */
export function isLikelyStaleWebBundleError(reason: unknown): boolean {
  const msg =
    reason instanceof Error
      ? reason.message
      : reason && typeof reason === 'object' && 'message' in reason
        ? String((reason as { message: unknown }).message)
        : String(reason ?? '');
  const m = msg.toLowerCase();
  if (m.includes("unexpected token '<'") || m.includes('unexpected token "<"')) return true;
  if (m.includes('unexpected token') && m.includes('<')) return true;
  if (m.includes('failed to fetch dynamically imported module')) return true;
  if (m.includes('error loading dynamically imported module')) return true;
  if (m.includes('importing a module script failed')) return true;
  if (m.includes('requiring unknown module')) return true;
  if (m.includes('loading chunk') && m.includes('failed')) return true;
  if (m.includes('chunk load error')) return true;
  return false;
}

let installed = false;

export function installWebChunkLoadRecovery(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || installed) return;
  installed = true;

  const tryRecover = (): void => {
    try {
      if (window.sessionStorage.getItem(SESSION_KEY) === '1') {
        window.setTimeout(() => {
          try {
            window.alert(
              `${uiCopy.common.staleWebBundleTitle}\n\n${uiCopy.common.staleWebBundleBody}`,
            );
          } catch {
            /* ignore */
          }
        }, 0);
        return;
      }
      window.sessionStorage.setItem(SESSION_KEY, '1');
      window.location.reload();
    } catch {
      /* ignore */
    }
  };

  window.addEventListener('unhandledrejection', (event) => {
    if (isLikelyStaleWebBundleError(event.reason)) {
      event.preventDefault?.();
      tryRecover();
    }
  });

  window.addEventListener(
    'error',
    (event) => {
      if (isLikelyStaleWebBundleError(event.error) || isLikelyStaleWebBundleError(event.message)) {
        tryRecover();
        return;
      }
      const t = event.target as unknown as { src?: string } | null;
      const src = typeof t?.src === 'string' ? t.src.toLowerCase() : '';
      if (
        src &&
        /\.js(\?|$)/i.test(src) &&
        (src.includes('chunk') || src.includes('static') || src.includes('_expo'))
      ) {
        tryRecover();
      }
    },
    true,
  );

  window.addEventListener('load', () => {
    window.setTimeout(() => {
      try {
        window.sessionStorage.removeItem(SESSION_KEY);
      } catch {
        /* ignore */
      }
    }, 6_000);
  });
}
