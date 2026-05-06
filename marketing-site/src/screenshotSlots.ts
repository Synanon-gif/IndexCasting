/**
 * Screenshot production map — marketing landing only.
 * Each slot is a planned capture: replace ProductShowcaseFrame placeholders when assets exist.
 *
 * IDs are stable: use in data-slot on frames for traceability.
 */

export type ScreenshotSection = 'hero' | 'agency' | 'client' | 'model' | 'trust';

export type ScreenshotFormat = 'desktop' | 'mobile' | 'mixed';

export type ScreenshotSlot = {
  id: string;
  section: ScreenshotSection;
  format: ScreenshotFormat;
  /** Short label for frame chrome */
  label: string;
  /** What this shot should prove */
  purpose: string;
};

export const SCREENSHOT_SLOTS: readonly ScreenshotSlot[] = [
  /* A — Hero */
  {
    id: 'hero-overview-web',
    section: 'hero',
    format: 'desktop',
    label: 'Product overview · web',
    purpose: 'Desktop shell: navigation, main workspace, sense of connected product',
  },
  {
    id: 'hero-overview-mobile',
    section: 'hero',
    format: 'mobile',
    label: 'Product overview · mobile',
    purpose: 'Phone frame: same spine on device — inbox/calendar/discovery hint',
  },

  /* B — Agency */
  {
    id: 'agency-dashboard',
    section: 'agency',
    format: 'desktop',
    label: 'Agency dashboard',
    purpose: 'Command view: attention, shortcuts, operational clarity',
  },
  {
    id: 'agency-roster',
    section: 'agency',
    format: 'desktop',
    label: 'My Models · roster',
    purpose: 'Roster density, territories, model status at a glance',
  },
  {
    id: 'agency-recruiting',
    section: 'agency',
    format: 'desktop',
    label: 'Recruiting',
    purpose: 'Applications pipeline tied to agency — not a side inbox',
  },
  {
    id: 'agency-calendar',
    section: 'agency',
    format: 'desktop',
    label: 'Agency calendar',
    purpose: 'Live holds, options, job states — one legible diary',
  },
  {
    id: 'agency-client-thread',
    section: 'agency',
    format: 'desktop',
    label: 'Agency ↔ Client',
    purpose: 'B2B thread with booking context — not a naked chat',
  },
  {
    id: 'agency-projects',
    section: 'agency',
    format: 'desktop',
    label: 'Projects · packages',
    purpose: 'Client-facing packages and project coordination',
  },

  /* C — Client */
  {
    id: 'client-discovery-swipe',
    section: 'client',
    format: 'desktop',
    label: 'Discovery',
    purpose: 'Swipe / visual-first talent exploration',
  },
  {
    id: 'client-shortlist',
    section: 'client',
    format: 'desktop',
    label: 'Shortlist',
    purpose: 'Curated set — decisions kept in one place',
  },
  {
    id: 'client-project',
    section: 'client',
    format: 'desktop',
    label: 'Project organization',
    purpose: 'Production model set and structure',
  },
  {
    id: 'client-agency-chat',
    section: 'client',
    format: 'desktop',
    label: 'Client ↔ Agency',
    purpose: 'Coordination thread with casting context',
  },
  {
    id: 'client-booking-confirm',
    section: 'client',
    format: 'desktop',
    label: 'Booking confirmation',
    purpose: 'Calendar / confirmation moment — lifecycle visible',
  },

  /* D — Model */
  {
    id: 'model-home-inbox',
    section: 'model',
    format: 'mobile',
    label: 'Home · inbox',
    purpose: 'Requests and actions — mobile-first entry',
  },
  {
    id: 'model-availability',
    section: 'model',
    format: 'mobile',
    label: 'Availability',
    purpose: 'Confirm or decline — clear agency context',
  },
  {
    id: 'model-agency-chat',
    section: 'model',
    format: 'mobile',
    label: 'Agency chat',
    purpose: 'Direct line to bookers on the same spine',
  },
  {
    id: 'model-calendar',
    section: 'model',
    format: 'mobile',
    label: 'Calendar',
    purpose: 'Personal schedule aligned with bookings',
  },
  {
    id: 'model-apply',
    section: 'model',
    format: 'mobile',
    label: 'Apply · profile',
    purpose: 'Entry path — applications and representation signal',
  },

  /* E — Trust */
  {
    id: 'trust-visibility',
    section: 'trust',
    format: 'desktop',
    label: 'Visibility · sharing',
    purpose: 'Scopes, consent-facing controls — calm, professional',
  },
] as const;

export function slotsForSection(section: ScreenshotSection): ScreenshotSlot[] {
  return SCREENSHOT_SLOTS.filter((s) => s.section === section);
}

export function getScreenshotSlot(id: string): ScreenshotSlot | undefined {
  return SCREENSHOT_SLOTS.find((s) => s.id === id);
}
