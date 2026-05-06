import { useSyncExternalStore } from 'react';

function subscribe(query: string, callback: () => void) {
  const m = window.matchMedia(query);
  m.addEventListener('change', callback);
  return () => m.removeEventListener('change', callback);
}

function getSnapshot(query: string) {
  return window.matchMedia(query).matches;
}

/** CSR-only marketing bundle — server snapshot assumes no match to avoid hydration mismatch if ever SSR'd. */
function getServerSnapshot() {
  return false;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => subscribe(query, cb),
    () => getSnapshot(query),
    getServerSnapshot,
  );
}
