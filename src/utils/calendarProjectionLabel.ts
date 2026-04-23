/**
 * Calendar projection labels/colors — approval-phase truth (Dimension 2), not raw price noise.
 * Commercial amounts stay on option rows; see `agencyCalendarUnified.ts` header.
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
 * `user_calendar_events` row: DB may still carry a stale orange swatch after job confirm
 * while `title` was updated by trigger — align block color with title/legend.
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
      // Title already matches canonical Job shapes (e.g. "Client 3 – job") — use Job green like
      // the legend; status can still be tentative until DB flips.
      if (displayTitleIndicatesCanonicalJob(calendar_entry?.title)) {
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

/** Standalone `calendar_entries` row (month dot, model agenda) — same colors as booking badges. */
export function getCalendarEntryBlockColor(
  entry: Pick<CalendarEntry, 'entry_type' | 'status'> & { title?: string | null },
): string {
  return getBookingEntryProjectionBadge(entry, COLOR_ONLY_LABELS).backgroundColor;
}

/**
 * Month grid dot color for an option+calendar item.
 *
 * Canonical: identical color logic to {@link getCalendarProjectionBadge} — both
 * resolve via {@link resolveProjectionBucket} / {@link projectionBucketColor}.
 * Month dot, week chip and day block MUST never diverge for the same row;
 * see system-invariants §28.2 (calendar colors single source) and `.cursorrules` §28.2.
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
