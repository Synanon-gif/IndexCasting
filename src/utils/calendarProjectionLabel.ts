/**
 * Calendar projection labels/colors — approval-phase truth (Dimension 2), not raw price noise.
 * Commercial amounts stay on option rows; see `agencyCalendarUnified.ts` header.
 */
import type { SupabaseOptionRequest } from '../services/optionRequestsSupabase';
import type { CalendarEntry } from '../services/calendarSupabase';
import { CALENDAR_COLORS, calendarEntryColor } from './calendarColors';
import { colors } from '../theme/theme';
import type { CalendarDayEvent } from '../components/MonthCalendarView';
import { attentionSignalsFromOptionRequestLike, deriveApprovalAttention } from './optionRequestAttention';

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

function isJobProjection(option: SupabaseOptionRequest, calendar_entry: CalendarEntry | null): boolean {
  if (option.final_status === 'job_confirmed') return true;
  return calendar_entry?.entry_type === 'booking';
}

function isCastingProjection(option: SupabaseOptionRequest, calendar_entry: CalendarEntry | null): boolean {
  const et = calendar_entry?.entry_type;
  if (et === 'casting' || et === 'gosee') return true;
  if (option.request_type === 'casting' && !isJobProjection(option, calendar_entry)) return true;
  return false;
}

const AWAITING_MODEL_BADGE_BG = '#7B1FA2';
const CLIENT_JOB_BADGE_BG = '#5D4037';

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
  const textColor = '#fff';

  if (option.status === 'rejected') {
    return { label: labels.rejected, backgroundColor: colors.textSecondary, textColor };
  }

  if (isJobProjection(option, calendar_entry)) {
    const tentative = calendar_entry?.status === 'tentative';
    return {
      label: tentative ? labels.jobTentative : labels.job,
      backgroundColor: tentative ? CALENDAR_COLORS.option : CALENDAR_COLORS.job,
      textColor,
    };
  }

  if (isCastingProjection(option, calendar_entry)) {
    return {
      label: labels.casting,
      backgroundColor: colors.textSecondary,
      textColor,
    };
  }

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
    }),
  );

  if (appr === 'waiting_for_agency_confirmation') {
    return {
      label: labels.optionNegotiating,
      backgroundColor: '#1565C0',
      textColor,
    };
  }

  if (appr === 'waiting_for_model_confirmation') {
    const label =
      viewerRole === 'model' ? labels.yourConfirmationNeeded : labels.awaitingModel;
    return { label, backgroundColor: AWAITING_MODEL_BADGE_BG, textColor };
  }

  if (appr === 'waiting_for_client_to_finalize_job') {
    return {
      label: labels.awaitingClientJob,
      backgroundColor: CLIENT_JOB_BADGE_BG,
      textColor,
    };
  }

  if (appr === 'approval_inactive') {
    return {
      label: labels.optionNegotiating,
      backgroundColor: '#1565C0',
      textColor,
    };
  }

  if (appr === 'fully_cleared' || appr === 'job_completed') {
    if (option.final_status === 'option_confirmed' || option.status === 'confirmed') {
      return {
        label: labels.optionConfirmed,
        backgroundColor: CALENDAR_COLORS.job,
        textColor,
      };
    }
  }

  if (option.status === 'in_negotiation') {
    return {
      label: labels.optionNegotiating,
      backgroundColor: '#1565C0',
      textColor,
    };
  }

  return {
    label: labels.optionPending,
    backgroundColor: '#1565C0',
    textColor,
  };
}

/** Standalone calendar row (e.g. booking_events) without option join. */
export function getBookingEntryProjectionBadge(
  entry: Pick<CalendarEntry, 'entry_type' | 'status'>,
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
    return { label: labels.casting, backgroundColor: colors.textSecondary, textColor };
  }
  return { label: labels.optionPending, backgroundColor: '#1565C0', textColor };
}

/**
 * Month grid dot color for an option+calendar item (matches list badge semantics loosely).
 */
export function calendarGridColorForOptionItem(item: {
  option: SupabaseOptionRequest;
  calendar_entry: CalendarEntry | null;
}): string {
  const { option, calendar_entry } = item;
  if (option.status === 'rejected') return colors.textSecondary;
  if (isJobProjection(option, calendar_entry)) {
    return calendar_entry?.status === 'tentative' ? CALENDAR_COLORS.option : CALENDAR_COLORS.job;
  }
  if (isCastingProjection(option, calendar_entry)) return colors.textSecondary;
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
    }),
  );
  if (appr === 'waiting_for_model_confirmation') return AWAITING_MODEL_BADGE_BG;
  if (appr === 'waiting_for_client_to_finalize_job') return CLIENT_JOB_BADGE_BG;
  const et = calendar_entry?.entry_type;
  return calendarEntryColor(et ?? 'option');
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
