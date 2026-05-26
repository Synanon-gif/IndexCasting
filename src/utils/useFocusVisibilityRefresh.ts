import { useEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { createDebouncedScheduler } from './debouncedScheduler';

/**
 * Debounced refresh when the app regains focus (native AppState, web visibility / window).
 * Coalesces burst triggers (tab switch + focus + visibility) into one callback.
 */
export function useFocusVisibilityRefresh(
  onRefresh: () => void,
  enabled = true,
  debounceMs = 400,
): void {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (!enabled) return;

    const { schedule, clear } = createDebouncedScheduler(() => onRefreshRef.current(), debounceMs);

    const appSub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') schedule();
    });

    let removeVis: (() => void) | undefined;
    let removeFocus: (() => void) | undefined;

    if (Platform.OS === 'web' && typeof document !== 'undefined' && typeof window !== 'undefined') {
      const onVis = () => {
        if (document.visibilityState === 'visible') schedule();
      };
      const onWinFocus = () => schedule();
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('focus', onWinFocus);
      removeVis = () => document.removeEventListener('visibilitychange', onVis);
      removeFocus = () => window.removeEventListener('focus', onWinFocus);
    }

    return () => {
      appSub.remove();
      removeVis?.();
      removeFocus?.();
      clear();
    };
  }, [enabled, debounceMs]);
}
