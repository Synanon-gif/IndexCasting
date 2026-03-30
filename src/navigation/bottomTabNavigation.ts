/**
 * Shared bottom-tab behavior: re-tapping the active tab resets nested UI to that tab's root.
 * Used by ClientWebApp, AgencyControllerView, ModelProfileScreen (state-based tabs, not URL routes).
 */

/** Default visual height of the sticky bottom tab bar (padding is added separately via safe area). */
export const BOTTOM_TAB_BAR_HEIGHT = 56;

export type HandleTabPressParams<T> = {
  current: T;
  next: T;
  setTab: (tab: T) => void;
  /** Clears nested state for `current` when user re-selects the same tab. */
  onReselectRoot: () => void;
};

/**
 * If `next` differs from `current`, switches tab. If equal, calls `onReselectRoot` instead
 * (native-app pattern: pop to root of the current section).
 */
export function handleTabPress<T>(params: HandleTabPressParams<T>): void {
  const { current, next, setTab, onReselectRoot } = params;
  if (next === current) {
    onReselectRoot();
    return;
  }
  setTab(next);
}
