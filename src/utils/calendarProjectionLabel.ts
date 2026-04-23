/**
 * Calendar projection labels/colors — approval-phase truth (Dimension 2), not raw price noise.
 * Commercial amounts stay on option rows; see `agencyCalendarUnified.ts` header.
 *
 * **Locked single hierarchy (no second semantic palette) — all active calendar surfaces must use this:**
 * 1. **Projection** — When equivalent `option` + `calendar_entry` context exists, semantic hex is
 *    authoritative: `resolveProjectionBucket` → `projectionBucketColor` (via
 *    `getCalendarProjectionBadge` / `calendarGridColorForOptionItem`).
 * 2. **Entry-only fallback** — `getCalendarEntryBlockColor` / `getBookingEntryProjectionBadge` for
 *    standalone `calendar_entries` or when the model side has no cached `OptionRequest` (intentional
 *    B2B/model parity gap only in that case).
 * 3. **Manual** — `resolveUserCalendarEventBlockColor` for `user_calendar_events` (custom colors
 *    preserved; job-title override unchanged).
 * 4. **Overviews** — Strips/footers must aggregate **rendered** event hex; they must not replace
 *    distinct projection colors (e.g. purple/brown) with generic reject/“other” greys. See
 *    `calendarOverviewLayout` (`monthDayKindSegments` / `weekColumnKindSegments`).
 *
 * New or reactivated UIs: reuse these entry points; do not duplicate rules or introduce parallel palettes.
 *
 * On model `calendar_entries`, the single color entry point is `resolveModelCalendarEntryColor` in
 * `modelCalendarSchedule.ts` (cached option → `calendarGridColorForOptionItem`; else `getCalendarEntryBlockColor`).
 */
import type { SupabaseOptionRequest } from '../services/optionRequestsSupabase';
import type { CalendarEntry } from '../services/calendarSupabase';
import { CALENDAR_COLORS, CALENDAR_PROJECTION_COLORS } from './calendarColors';
import type { CalendarDayEvent } from '../components/MonthCalendarView';
import {
  attentionSignalsFromOptionRequestLike,
  deriveApprovalAttention,
} from './optionRequestAttention';

/** User-visible strings — pass `uiCopy.calendar.projectionBadge` from callers. */
export type CalendarProjectionLabels = {
  rejected: string;
  job: string;
  jobTentative: string;
  casting: string;
  optionConfirmed: string;
  optionNegotiating: string;
  /** @deprecated Badges no longer use raw price-pending; kept for older call sites */
  pricePending?: string;
  /** @deprecated Badges no longer use raw price-agreed; kept for older call sites */
  priceAgreed?: string;
  optionPending: string;
  awaitingModel: string;
  /** Client must confirm job promotion (approval attention B). */
  awaitingClientJob: string;
  /** Agency-only flow: agency must confirm job (no client party). */
  awaitingAgencyJob?: string;
  yourConfirmationNeeded: string;
};

/** Who views the calendar — affects copy when model must still confirm. */
export type CalendarProjectionViewerRole = 'client' | 'agency' | 'model';

export type CalendarProjectionBadge = {
  label: string;
  backgroundColor: string;
  /** Contrast text on badge (always light in current theme). */
  textColor: string;
};

/**
 * Collapse Unicode dash / minus shapes to ASCII hyphen so Job detection matches
 * trigger output regardless of en-dash vs em-dash vs hyphen (common copy/paste drift).
 */
function normalizeCalendarTitleDashesForJobMatch(s: string): string {
  return s.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-');
}

/**
 * True when visible text already matches the canonical Job title shapes produced by DB
 * triggers / RLS-safe updates ("Job – …", "… – job"), while `entry_type` or
 * `option_requests.final_status` can still lag in the client payload.
 * Kept aligned with {@link agencyCalendarUnified} `stripLifecycleAffixes` job arms.
 */
export function displayTitleIndicatesCanonicalJob(title: string | null | undefined): boolean {
  if (title == null) return false;
  const t0 = String(title).trim();
  if (!t0) return false;
  const t = normalizeCalendarTitleDashesForJobMatch(t0);
  if (/^job\s*-\s*/i.test(t)) return true;
  if (/-\s*job$/i.test(t)) return true;
  return false;
}

/**
 * First line of text used on B2B chips/month (`agencyCalendarUnified.unifiedOptionRowDisplayTitle`).
 * Tentative → Job color must use this string so it cannot diverge from `isJobProjection` signals.
 */
function unifiedB2BOptionLineForProjection(
  option: SupabaseOptionRequest,
  calendar_entry: CalendarEntry | null,
): string {
  const ce = calendar_entry?.title?.trim();
  if (ce) return ce;
  return (option.model_name ?? '').trim();
}

function isJobProjection(
  option: SupabaseOptionRequest,
  calendar_entry: CalendarEntry | null,
): boolean {
  if (option.final_status === 'job_confirmed') return true;
  if (calendar_entry?.entry_type === 'booking') return true;
  if (displayTitleIndicatesCanonicalJob(calendar_entry?.title)) return true;
  if (displayTitleIndicatesCanonicalJob(option.model_name)) return true;
  if (displayTitleIndicatesCanonicalJob(option.client_organization_name)) return true;
  if (displayTitleIndicatesCanonicalJob(option.client_name)) return true;
  return false;
}

/**
 * B2B manual `user_calendar_events` — not part of the option projection pipeline.
 * Preserves user/DB `color` for custom/personal swatches; only forces job green when the **title**
 * matches canonical job shapes. Do not route through `resolveProjectionBucket`.
 */
export function resolveUserCalendarEventBlockColor(ev: { title: string; color: string }): string {
  if (displayTitleIndicatesCanonicalJob(ev.title)) return CALENDAR_COLORS.job;
  return ev.color || CALENDAR_COLORS.personal;
}

function isCastingProjection(
  option: SupabaseOptionRequest,
  calendar_entry: CalendarEntry | null,
): boolean {
  const et = calendar_entry?.entry_type;
  if (et === 'casting' || et === 'gosee') return true;
  if (option.request_type === 'casting' && !isJobProjection(option, calendar_entry)) return true;
  return false;
}

/**
 * Canonical projection bucket — single source of truth shared by week/day badges
 * (`getCalendarProjectionBadge`) and month grid dots (`calendarGridColorForOptionItem`).
 * Any color/label divergence between calendar views was always a regression of this contract.
 */
export type CalendarProjectionBucket =
  | 'rejected'
  | 'jobTentative'
  | 'jobConfirmed'
  | 'casting'
  | 'awaitingAgencyConfirmation'
  | 'awaitingModelConfirmation'
  | 'awaitingClientJob'
  | 'awaitingAgencyJob'
  | 'optionConfirmed'
  | 'optionNegotiating'
  | 'optionPending';

function resolveProjectionBucket(
  option: SupabaseOptionRequest,
  calendar_entry: CalendarEntry | null,
): CalendarProjectionBucket {
  if (option.status === 'rejected') return 'rejected';

  if (isJobProjection(option, calendar_entry)) {
    const tentative = calendar_entry?.status === 'tentative';
    if (tentative) {
      // Visible B2B line (calendar title or `model_name`) already Job-shaped — Job green; status may lag.
      if (
        displayTitleIndicatesCanonicalJob(unifiedB2BOptionLineForProjection(option, calendar_entry))
      ) {
        return 'jobConfirmed';
      }
      return 'jobTentative';
    }
    return 'jobConfirmed';
  }

  if (isCastingProjection(option, calendar_entry)) return 'casting';

  const appr = deriveApprovalAttention(
    attentionSignalsFromOptionRequestLike({
      status: option.status,
      finalStatus: option.final_status,
      clientPriceStatus: option.client_price_status,
      modelApproval: option.model_approval,
      modelAccountLinked: option.model_account_linked,
      agencyCounterPrice: option.agency_counter_price,
      proposedPrice: option.proposed_price,
      isAgencyOnly: option.is_agency_only ?? false,
      requestType: option.request_type ?? null,
    }),
  );

  if (appr === 'waiting_for_agency_confirmation') return 'awaitingAgencyConfirmation';
  if (appr === 'waiting_for_model_confirmation') return 'awaitingModelConfirmation';
  if (appr === 'waiting_for_client_to_finalize_job') return 'awaitingClientJob';
  if (appr === 'waiting_for_agency_to_finalize_job') return 'awaitingAgencyJob';
  if (appr === 'approval_inactive') return 'optionNegotiating';

  if (
    (appr === 'fully_cleared' || appr === 'job_completed') &&
    (option.final_status === 'option_confirmed' || option.status === 'confirmed')
  ) {
    return 'optionConfirmed';
  }

  if (option.status === 'in_negotiation') return 'optionNegotiating';

  return 'optionPending';
}

function projectionBucketColor(bucket: CalendarProjectionBucket): string {
  // Canonical mapping — must match `CalendarColorLegend` exactly:
  //   Option lifecycle (pending / negotiating / awaiting agency / confirmed)  → option orange
  //   Casting lifecycle                                                       → casting blue
  //   Job confirmed                                                           → job green
  //   Tentative job without Job-shaped title yet (footnote `legendTentativeJobNote`) → option orange
  //   Awaiting model approval (special projection)                            → awaitingModel purple
  //   Awaiting client/agency to finalize job (special projection)             → jobConfirmationPending brown
  //   Rejected / inactive                                                     → rejected grey
  switch (bucket) {
    case 'rejected':
      return CALENDAR_PROJECTION_COLORS.rejected;
    case 'jobTentative':
      return CALENDAR_COLORS.option;
    case 'jobConfirmed':
      return CALENDAR_COLORS.job;
    case 'casting':
      return CALENDAR_COLORS.casting;
    case 'awaitingAgencyConfirmation':
      return CALENDAR_COLORS.option;
    case 'awaitingModelConfirmation':
      return CALENDAR_PROJECTION_COLORS.awaitingModel;
    case 'awaitingClientJob':
    case 'awaitingAgencyJob':
      return CALENDAR_PROJECTION_COLORS.jobConfirmationPending;
    case 'optionConfirmed':
    case 'optionNegotiating':
    case 'optionPending':
      return CALENDAR_COLORS.option;
  }
}

function projectionBucketLabel(
  bucket: CalendarProjectionBucket,
  labels: CalendarProjectionLabels,
  viewerRole: CalendarProjectionViewerRole,
): string {
  switch (bucket) {
    case 'rejected':
      return labels.rejected;
    case 'jobTentative':
      return labels.jobTentative;
    case 'jobConfirmed':
      return labels.job;
    case 'casting':
      return labels.casting;
    case 'awaitingAgencyConfirmation':
      return labels.optionNegotiating;
    case 'awaitingModelConfirmation':
      return viewerRole === 'model' ? labels.yourConfirmationNeeded : labels.awaitingModel;
    case 'awaitingClientJob':
      return labels.awaitingClientJob;
    case 'awaitingAgencyJob':
      return labels.awaitingAgencyJob ?? labels.awaitingClientJob;
    case 'optionConfirmed':
      return labels.optionConfirmed;
    case 'optionNegotiating':
      return labels.optionNegotiating;
    case 'optionPending':
      return labels.optionPending;
  }
}

/**
 * Badge for an option row + optional calendar_entry (client & agency lists).
 * Uses {@link deriveApprovalAttention} — not `client_price_status` alone.
 * **Semantic `backgroundColor` is always `projectionBucketColor` — `viewerRole` affects copy only.**
 */
export function getCalendarProjectionBadge(
  option: SupabaseOptionRequest,
  calendar_entry: CalendarEntry | null,
  labels: CalendarProjectionLabels,
  viewerRole: CalendarProjectionViewerRole = 'client',
): CalendarProjectionBadge {
  const bucket = resolveProjectionBucket(option, calendar_entry);
  return {
    label: projectionBucketLabel(bucket, labels, viewerRole),
    backgroundColor: projectionBucketColor(bucket),
    textColor: '#fff',
  };
}

/** Standalone calendar row (e.g. booking_events) without option join. */
export function getBookingEntryProjectionBadge(
  entry: Pick<CalendarEntry, 'entry_type' | 'status'> & { title?: string | null },
  labels: Pick<CalendarProjectionLabels, 'job' | 'jobTentative' | 'casting' | 'optionPending'>,
): CalendarProjectionBadge {
  const textColor = '#fff';
  const t = entry.entry_type;
  if (t === 'booking') {
    const tentative = entry.status === 'tentative';
    return {
      label: tentative ? labels.jobTentative : labels.job,
      backgroundColor: tentative ? CALENDAR_COLORS.option : CALENDAR_COLORS.job,
      textColor,
    };
  }
  // Gosee uses the same calendar blue as casting (not `CALENDAR_COLORS.gosee`) — legend + B2B parity.
  if (t === 'casting' || t === 'gosee') {
    return { label: labels.casting, backgroundColor: CALENDAR_COLORS.casting, textColor };
  }
  if (displayTitleIndicatesCanonicalJob(entry.title)) {
    return { label: labels.job, backgroundColor: CALENDAR_COLORS.job, textColor };
  }
  return { label: labels.optionPending, backgroundColor: CALENDAR_COLORS.option, textColor };
}

const COLOR_ONLY_LABELS: Pick<
  CalendarProjectionLabels,
  'job' | 'jobTentative' | 'casting' | 'optionPending'
> = {
  job: '',
  jobTentative: '',
  casting: '',
  optionPending: '',
};

/**
 * **Entry-only fallback (hierarchy #2).** Use for standalone `calendar_entries` and for model
 * surfaces when `resolveModelCalendarEntryColor` has no cached `OptionRequest`. Same hex as
 * {@link getBookingEntryProjectionBadge}. When option + entry projection context exists, use
 * {@link calendarGridColorForOptionItem} instead — do not duplicate projection rules in callers.
 */
export function getCalendarEntryBlockColor(
  entry: Pick<CalendarEntry, 'entry_type' | 'status'> & { title?: string | null },
): string {
  return getBookingEntryProjectionBadge(entry, COLOR_ONLY_LABELS).backgroundColor;
}

/**
 * **Projection-authoritative hex (hierarchy #1)** for option-linked rows when B2B or model has
 * equivalent `SupabaseOptionRequest` + `calendar_entry` context. Identical to
 * {@link getCalendarProjectionBadge}’s `backgroundColor` (`resolveProjectionBucket` →
 * `projectionBucketColor`). New calendar surfaces with option joins must use this (or the badge) —
 * not ad-hoc `entry_type` or `calendarEntryColor` styling.
 */
export function calendarGridColorForOptionItem(item: {
  option: SupabaseOptionRequest;
  calendar_entry: CalendarEntry | null;
}): string {
  const bucket = resolveProjectionBucket(item.option, item.calendar_entry);
  return projectionBucketColor(bucket);
}

/**
 * Coarse month/week kind strip — same projection color family as the chip (legend), not raw `entry_type`.
 */
export type CoarseCalendarOverviewKind = 'job' | 'casting' | 'option' | 'other';

export function coarseOverviewKindFromProjectionColor(color: string): CoarseCalendarOverviewKind {
  if (color === CALENDAR_COLORS.job) return 'job';
  if (color === CALENDAR_COLORS.casting) return 'casting';
  if (color === CALENDAR_COLORS.option) return 'option';
  return 'other';
}

export function coarseOverviewKindForOptionItem(item: {
  option: SupabaseOptionRequest;
  calendar_entry: CalendarEntry | null;
}): CoarseCalendarOverviewKind {
  const b = resolveProjectionBucket(item.option, item.calendar_entry);
  return coarseOverviewKindFromProjectionColor(projectionBucketColor(b));
}

/**
 * Defensive dedupe: same calendar day + same option_request should not render twice
 * (e.g. legacy drift). Manual rows and orphan booking rows dedupe by `id` only.
 */
export function dedupeCalendarGridEventsByOptionRequest(
  eventsByDate: Record<string, CalendarDayEvent[]>,
): Record<string, CalendarDayEvent[]> {
  const out: Record<string, CalendarDayEvent[]> = {};
  for (const [date, list] of Object.entries(eventsByDate)) {
    const seen = new Set<string>();
    const next: CalendarDayEvent[] = [];
    for (const ev of list) {
      const key = ev.optionRequestId ? `opt:${ev.optionRequestId}` : ev.id;
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(ev);
    }
    out[date] = next;
  }
  return out;
}
