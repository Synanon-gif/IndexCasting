/**
 * Agency calendar: merge option_requests/calendar_entries, booking_events, manual events
 * for consistent filtering and list/grid views (visibility unchanged — filter-only).
 *
 * Commercial terms: canonical agreed/proposed amounts live on `option_requests` (and RPC logic).
 * `calendar_entries` rows created by `fn_ensure_calendar_on_option_confirmed` carry schedule/title;
 * do not treat calendar JSON alone as the fee source of truth.
 */
import type { AgencyCalendarItem, CalendarEntry } from '../services/calendarSupabase';
import type { UserCalendarEvent } from '../services/userCalendarEventsSupabase';
import type { ClientAssignmentFlag } from '../services/clientAssignmentsSupabase';
import { colors } from '../theme/theme';
import { calendarGridColorForOptionItem } from './calendarProjectionLabel';
import { attentionSignalsFromOptionRequestLike } from './optionRequestAttention';
import { attentionHeaderLabelFromSignals } from './negotiationAttentionLabels';

export type AgencyCalendarCategory = 'option' | 'casting' | 'booking';

export type UnifiedAgencyCalendarRow =
  | {
      kind: 'option';
      sortKey: string;
      id: string;
      date: string;
      title: string;
      item: AgencyCalendarItem;
      category: AgencyCalendarCategory;
      /** Resolved: option agency assignee OR client_assignment_flags assignee for client org */
      effectiveAssigneeUserId: string | null;
      needsAgencyAction: boolean;
    }
  | {
      kind: 'booking';
      sortKey: string;
      id: string;
      date: string;
      title: string;
      entry: CalendarEntry;
      category: AgencyCalendarCategory;
      effectiveAssigneeUserId: string | null;
      /** Tentative / non-final booking_events row — agency should act */
      needsAgencyAction: boolean;
    }
  | {
      kind: 'manual';
      sortKey: string;
      id: string;
      date: string;
      title: string;
      ev: UserCalendarEvent;
    };

export type AgencyCalendarTypeFilter = 'all' | AgencyCalendarCategory;

/** all | unassigned | mine | specific member user_id */
export type AgencyCalendarAssigneeFilter = 'all' | 'unassigned' | 'mine' | string;

/** Narrow to client orgs explicitly assigned to me in client_assignment_flags */
export type AgencyCalendarClientScopeFilter = 'all' | 'mine' | 'unassigned';

export type AgencyCalendarUrgencyFilter = 'all' | 'action' | 'clear';

function normalizeOptionCategory(item: AgencyCalendarItem): AgencyCalendarCategory {
  const et = item.calendar_entry?.entry_type;
  if (et === 'booking') return 'booking';
  if (et === 'casting' || et === 'gosee') return 'casting';
  if (et === 'option') return 'option';
  if (item.option.final_status === 'job_confirmed') return 'booking';
  if (item.option.request_type === 'casting') return 'casting';
  return 'option';
}

function normalizeBookingEntryCategory(entry: CalendarEntry): AgencyCalendarCategory {
  const t = entry.entry_type;
  if (t === 'booking') return 'booking';
  if (t === 'casting' || t === 'gosee') return 'casting';
  return 'option';
}

export function effectiveAssigneeForOption(
  item: AgencyCalendarItem,
  assignmentByClientOrgId: Record<string, ClientAssignmentFlag>,
): string | null {
  const opt = item.option;
  if (opt.agency_assignee_user_id) return opt.agency_assignee_user_id;
  const cid = opt.client_organization_id;
  if (cid && assignmentByClientOrgId[cid]?.assignedMemberUserId) {
    return assignmentByClientOrgId[cid].assignedMemberUserId;
  }
  return null;
}

/** Calendar "Action needed" — agency header attention (negotiation + approval), same gate as Messages list. */
export function needsAgencyActionForOption(item: AgencyCalendarItem): boolean {
  const opt = item.option;
  const sig = attentionSignalsFromOptionRequestLike({
    status: opt.status,
    finalStatus: opt.final_status,
    clientPriceStatus: opt.client_price_status,
    modelApproval: opt.model_approval,
    modelAccountLinked: opt.model_account_linked,
    agencyCounterPrice: opt.agency_counter_price,
    proposedPrice: opt.proposed_price,
    hasConflictWarning: false,
  });
  return attentionHeaderLabelFromSignals(sig, 'agency') !== null;
}

/**
 * Merge calendar sources. Booking rows that duplicate an option_request already represented
 * in `items` (same option_request_id on calendar_entry) are skipped — same rule as the view.
 */
export function buildUnifiedAgencyCalendarRows(
  items: AgencyCalendarItem[],
  bookingEventEntries: CalendarEntry[],
  manualEvents: UserCalendarEvent[],
  assignmentByClientOrgId: Record<string, ClientAssignmentFlag>,
  itemByOptionId: Map<string, AgencyCalendarItem>,
): UnifiedAgencyCalendarRow[] {
  const coveredOptionIds = new Set<string>(
    [
      ...items.map((i) => i.calendar_entry?.option_request_id).filter(Boolean) as string[],
      ...items.map((i) => i.option?.id).filter(Boolean) as string[],
    ],
  );

  const optionRows: UnifiedAgencyCalendarRow[] = items.map((item) => {
    const date = item.calendar_entry?.date ?? item.option.requested_date ?? '';
    const category = normalizeOptionCategory(item);
    const effectiveAssigneeUserId = effectiveAssigneeForOption(item, assignmentByClientOrgId);
    const needsAgencyAction = needsAgencyActionForOption(item);
    const title = item.option.model_name ?? 'Model';
    return {
      kind: 'option',
      sortKey: `${date}\0${title}\0${item.option.id}`,
      id: item.option.id,
      date,
      title,
      item,
      category,
      effectiveAssigneeUserId,
      needsAgencyAction,
    };
  });

  // Fallback dedup set: date + model_id pairs already covered by option rows.
  // booking_events with source_option_request_id = null cannot be matched by ID, so we
  // suppress them when the same model appears on the same date via an option row.
  const coveredDateModelPairs = new Set<string>(
    optionRows
      .filter((r): r is Extract<UnifiedAgencyCalendarRow, { kind: 'option' }> => r.kind === 'option' && !!r.item.option.model_id)
      .map((r) => `${r.date}|${r.item.option.model_id}`),
  );

  const bookingRows: UnifiedAgencyCalendarRow[] = [];
  for (const be of bookingEventEntries) {
    // Primary dedup: same option_request_id already covered.
    if (be.option_request_id && coveredOptionIds.has(be.option_request_id)) continue;
    // Fallback dedup: same model on same date — suppress duplicate regardless of
    // whether option_request_id is set (handles null source_option_request_id and
    // scope mismatches between agency_id and agency_org_id fetch paths).
    if (be.model_id && coveredDateModelPairs.has(`${be.date ?? ''}|${be.model_id}`)) continue;
    const date = be.date ?? '';
    const category = normalizeBookingEntryCategory(be);
    let effectiveAssigneeUserId: string | null = null;
    if (be.option_request_id) {
      const linked = itemByOptionId.get(be.option_request_id);
      if (linked) {
        effectiveAssigneeUserId = effectiveAssigneeForOption(linked, assignmentByClientOrgId);
      }
    }
    const needsAgencyAction = be.status === 'tentative';
    bookingRows.push({
      kind: 'booking',
      sortKey: `${date}\0${be.title ?? 'Booking'}\0${be.id}`,
      id: be.id,
      date,
      title: be.title ?? 'Booking',
      entry: be,
      category,
      effectiveAssigneeUserId,
      needsAgencyAction,
    });
  }

  const manualRows: UnifiedAgencyCalendarRow[] = manualEvents.map((ev) => ({
    kind: 'manual',
    sortKey: `${ev.date}\0${ev.title}\0${ev.id}`,
    id: ev.id,
    date: ev.date,
    title: ev.title,
    ev,
  }));

  return [...optionRows, ...bookingRows, ...manualRows];
}

export function filterUnifiedAgencyCalendarRows(
  rows: UnifiedAgencyCalendarRow[],
  params: {
    modelQuery: string;
    fromDate: string;
    toDate: string;
    typeFilter: AgencyCalendarTypeFilter;
    assigneeFilter: AgencyCalendarAssigneeFilter;
    clientScope: AgencyCalendarClientScopeFilter;
    urgency: AgencyCalendarUrgencyFilter;
    currentUserId: string | null;
    assignmentByClientOrgId: Record<string, ClientAssignmentFlag>;
  },
): UnifiedAgencyCalendarRow[] {
  const q = params.modelQuery.trim().toLowerCase();
  return rows.filter((row) => {
    const date = row.date;
    if (params.fromDate && date < params.fromDate) return false;
    if (params.toDate && date > params.toDate) return false;

    if (q) {
      const name =
        row.kind === 'option'
          ? (row.item.option.model_name || '').toLowerCase()
          : row.kind === 'booking'
            ? (row.title || '').toLowerCase()
            : (row.ev.title || '').toLowerCase();
      if (!name.includes(q)) return false;
    }

    if (params.typeFilter !== 'all') {
      if (row.kind === 'manual') return false;
      if (row.category !== params.typeFilter) return false;
    }

    if (row.kind === 'manual') return true;

    if (params.urgency === 'action') {
      if (row.kind === 'option' && !row.needsAgencyAction) return false;
      if (row.kind === 'booking' && !row.needsAgencyAction) return false;
    }
    if (params.urgency === 'clear') {
      if (row.kind === 'option' && row.needsAgencyAction) return false;
      if (row.kind === 'booking' && row.needsAgencyAction) return false;
    }

    const aid = row.effectiveAssigneeUserId;
    if (params.assigneeFilter === 'unassigned') {
      if (aid != null) return false;
    } else if (params.assigneeFilter === 'mine') {
      if (!params.currentUserId || aid !== params.currentUserId) return false;
    } else if (params.assigneeFilter !== 'all') {
      if (aid !== params.assigneeFilter) return false;
    }

    if (params.clientScope !== 'all') {
      if (row.kind === 'booking') return false;
      if (row.kind === 'option') {
        const cid = row.item.option.client_organization_id;
        const flag = cid ? params.assignmentByClientOrgId[cid] : undefined;
        const assignedMember = flag?.assignedMemberUserId ?? null;
        if (params.clientScope === 'mine') {
          if (!params.currentUserId || assignedMember !== params.currentUserId) return false;
        }
        if (params.clientScope === 'unassigned') {
          if (assignedMember != null) return false;
        }
      }
    }

    return true;
  });
}

/**
 * Final-pass dedup for the scrollable list: removes booking rows whose
 * option_request_id or date+model_id is already covered by an option row.
 * Apply this to `filteredUnified` / `sortedUnified` as a safety net after
 * `buildUnifiedAgencyCalendarRows` (handles edge cases such as mismatched
 * agency_id vs agency_org_id fetch scopes).
 */
export function dedupeUnifiedRowsByOptionRequest(
  rows: UnifiedAgencyCalendarRow[],
): UnifiedAgencyCalendarRow[] {
  const optionIds = new Set<string>(
    rows
      .filter((r): r is Extract<UnifiedAgencyCalendarRow, { kind: 'option' }> => r.kind === 'option')
      .map((r) => r.item.option.id),
  );
  const optionDateModel = new Set<string>(
    rows
      .filter((r): r is Extract<UnifiedAgencyCalendarRow, { kind: 'option' }> => r.kind === 'option' && !!r.item.option.model_id)
      .map((r) => `${r.date}|${r.item.option.model_id}`),
  );
  return rows.filter((r) => {
    if (r.kind !== 'booking') return true;
    if (r.entry.option_request_id && optionIds.has(r.entry.option_request_id)) return false;
    if (r.entry.model_id && optionDateModel.has(`${r.entry.date ?? ''}|${r.entry.model_id}`)) return false;
    return true;
  });
}

/** Month grid dots — must match list filtering (same ids as unified rows). */
export function buildEventsByDateFromUnifiedRows(
  rows: UnifiedAgencyCalendarRow[],
): Record<
  string,
  Array<{ id: string; color: string; title: string; kind?: string; optionRequestId?: string | null }>
> {
  const map: Record<
    string,
    Array<{ id: string; color: string; title: string; kind?: string; optionRequestId?: string | null }>
  > = {};
  for (const row of rows) {
    const date = row.date;
    if (!date) continue;
    if (!map[date]) map[date] = [];
    if (row.kind === 'manual') {
      map[date].push({
        id: row.id,
        color: row.ev.color || '#888',
        title: row.title,
        kind: 'manual',
      });
      continue;
    }
    if (row.kind === 'option') {
      const et = row.item.calendar_entry?.entry_type;
      const color = calendarGridColorForOptionItem({
        option: row.item.option,
        calendar_entry: row.item.calendar_entry,
      });
      map[date].push({
        id: row.id,
        color,
        title: row.title,
        kind: et ?? 'option',
        optionRequestId: row.item.option.id,
      });
      continue;
    }
    let color = '#1565C0';
    if (row.entry.entry_type === 'booking') color = colors.buttonSkipRed;
    else if (row.entry.entry_type === 'casting' || row.entry.entry_type === 'gosee') color = colors.textSecondary;
    map[date].push({
      id: row.id,
      color,
      title: row.title,
      kind: row.entry.entry_type ?? 'booking',
      optionRequestId: row.entry.option_request_id ?? undefined,
    });
  }
  return map;
}
