/**
 * Global layout breakpoints — shell / responsive UI only (no domain logic).
 * Mobile: single focus; tablet: hybrid; desktop: multi-panel.
 */
export const BREAKPOINT_MOBILE_MAX = 768;
export const BREAKPOINT_TABLET_MAX = 1024;

export type DeviceType = 'mobile' | 'tablet' | 'desktop';

/** Width strictly in (768, 1024) — tablet hybrid */
export function isTabletWidth(width: number): boolean {
  return width > BREAKPOINT_MOBILE_MAX && width < BREAKPOINT_TABLET_MAX;
}

/** Width <= 768 */
export function isMobileWidth(width: number): boolean {
  return width <= BREAKPOINT_MOBILE_MAX;
}

/** Width >= 1024 — desktop multi-panel */
export function isDesktopWidth(width: number): boolean {
  return width >= BREAKPOINT_TABLET_MAX;
}

export function deviceTypeFromWidth(width: number): DeviceType {
  if (width <= BREAKPOINT_MOBILE_MAX) return 'mobile';
  if (width < BREAKPOINT_TABLET_MAX) return 'tablet';
  return 'desktop';
}
