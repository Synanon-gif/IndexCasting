/**
 * Agency calendar: merge option_requests/calendar_entries, booking_events, manual events
 * for consistent filtering and list/grid views (visibility unchanged — filter-only).
 *
 * Commercial terms: canonical agreed/proposed amounts live on `option_requests` (and RPC logic).
 * `calendar_entries` rows created by `fn_ensure_calendar_on_option_confirmed` carry schedule/title;
 * do not treat calendar JSON alone as the fee source of truth.
 *
 * Dedupe / layer precedence aligns with `src/constants/calendarSourcePriority.ts` and
 * `calendar_export_events_json` (ICS): booking_events-derived job rows win over option tiles
 * via `preferJobBookingOverOptionRows`; mirror `user_calendar_events` suppressed when option
 * already in `items` (same as USER_CALENDAR_EVENT_MIRROR vs CALENDAR_ENTRY_* in SQL).
 */
import type { AgencyCalendarItem, CalendarEntry } from '../services/calendarSupabase';
import {
  BOOKING_EVENT,
  CALENDAR_ENTRY_BOOKING,
  CALENDAR_ENTRY_OPTION,
  USER_CALENDAR_EVENT_MIRROR,
  USER_CALENDAR_EVENT_MANUAL,
} from '../constants/calendarSourcePriority';
import type { UserCalendarEvent } from '../services/userCalendarEventsSupabase';
import type { ClientAssignmentFlag } from '../services/clientAssignmentsSupabase';
import { colors } from '../theme/theme';
import { calendarGridColorForOptionItem } from './calendarProjectionLabel';
import { CALENDAR_COLORS } from './calendarColors';
import { attentionSignalsFromOptionRequestLike } from './optionRequestAttention';
import { attentionHeaderLabelFromSignals } from './negotiationAttentionLabels';
import { uiCopy } from '../constants/uiCopy';

/** Same numeric ordering as SQL `calendar_export_events_json` / ICS `sourcePriority` (lower = wins). */
export const CALENDAR_SOURCE_PRIORITY_ORDER_FOR_AUDIT = [
  BOOKING_EVENT,
  CALENDAR_ENTRY_BOOKING,
  CALENDAR_ENTRY_OPTION,
  USER_CALENDAR_EVENT_MIRROR,
  USER_CALENDAR_EVENT_MANUAL,
] as const;

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
    isAgencyOnly: opt.is_agency_only ?? false,
    requestType: opt.request_type ?? null,
  });
  return attentionHeaderLabelFromSignals(sig, 'agency') !== null;
}

/**
 * Merge calendar sources. Booking rows that duplicate an option_request already represented
 * in `items` (same option_request_id on calendar_entry) are skipped — same rule as the view.
 *
 * `user_calendar_events` mirrored from `option_requests` (trigger `sync_user_calendars_on_option_confirmed`,
 * `source_option_request_id` set) are suppressed when the same option is already in `items`, so "All" does not
 * show a second tile (model-centric option row + client-titled mirror). Pure manual events
 * (`source_option_request_id` null) always remain; if an option is not in `items` (e.g. fetch window), the
 * mirror row still shows.
 *
 * Multi-layer dedup for booking_events ensures a single lifecycle never produces two visible calendar events:
 *   L1 — option_request_id exact match
 *   L2 — date + model_id composite
 *   L3 — date + normalised model_name (catches id mismatches between data sources)
 */
export function buildUnifiedAgencyCalendarRows(
  items: AgencyCalendarItem[],
  bookingEventEntries: CalendarEntry[],
  manualEvents: UserCalendarEvent[],
  assignmentByClientOrgId: Record<string, ClientAssignmentFlag>,
  itemByOptionId: Map<string, AgencyCalendarItem>,
): UnifiedAgencyCalendarRow[] {
  const coveredOptionIds = new Set<string>([
    ...(items.map((i) => i.calendar_entry?.option_request_id).filter(Boolean) as string[]),
    ...(items.map((i) => i.option?.id).filter(Boolean) as string[]),
  ]);

  const optionRows: UnifiedAgencyCalendarRow[] = items.map((item) => {
    const date = item.calendar_entry?.date ?? item.option.requested_date ?? '';
    const category = normalizeOptionCategory(item);
    const effectiveAssigneeUserId = effectiveAssigneeForOption(item, assignmentByClientOrgId);
    const needsAgencyAction = needsAgencyActionForOption(item);
    const title = item.option.model_name ?? uiCopy.common.unknownModel;
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

  // L2: date + model_id pairs already covered by option rows
  const coveredDateModelPairs = new Set<string>();
  // L3: date + normalised model name
  const coveredDateModelNames = new Set<string>();
  // L4: date + stripped name (prefix/suffix removed)
  const coveredDateStrippedNames = new Set<string>();
  // Also collect bare dates that have at least one option row (for last-resort suppression)
  const datesWithOptions = new Set<string>();

  for (const r of optionRows) {
    if (r.kind !== 'option') continue;
    const opt = r.item.option;
    if (r.date) datesWithOptions.add(r.date);
    if (opt.model_id && r.date) {
      coveredDateModelPairs.add(`${r.date}|${opt.model_id}`);
    }
    const name = (opt.model_name ?? '').trim().toLowerCase();
    if (name && r.date) {
      coveredDateModelNames.add(`${r.date}|${name}`);
      const stripped = stripLifecycleAffixes(name);
      if (stripped) coveredDateStrippedNames.add(`${r.date}|${stripped}`);
    }
    const ceTitle = (r.item.calendar_entry?.title ?? '').trim().toLowerCase();
    if (ceTitle && r.date) {
      const ceStripped = stripLifecycleAffixes(ceTitle);
      if (ceStripped) coveredDateStrippedNames.add(`${r.date}|${ceStripped}`);
    }
  }

  // Pre-index names by date for O(1) lookup in L5/L6 (avoids O(n*m) linear scan)
  const namesByDate = new Map<string, string[]>();
  for (const key of coveredDateModelNames) {
    const sep = key.indexOf('|');
    if (sep < 0) continue;
    const d = key.slice(0, sep);
    const n = key.slice(sep + 1);
    let arr = namesByDate.get(d);
    if (!arr) {
      arr = [];
      namesByDate.set(d, arr);
    }
    arr.push(n);
  }

  const bookingRows: UnifiedAgencyCalendarRow[] = [];
  for (const be of bookingEventEntries) {
    const beDate = be.date ?? '';
    /** Job rows from `booking_events` must survive L1–L6 so `preferJobBookingOverOptionRows` can drop the option tile. */
    const bypassLifecycleDedup = be.entry_type === 'booking' && Boolean(be.option_request_id);

    if (!bypassLifecycleDedup) {
      // L1: option_request_id exact match
      if (be.option_request_id && coveredOptionIds.has(be.option_request_id)) continue;
      // L2: date + model_id composite
      if (be.model_id && beDate && coveredDateModelPairs.has(`${beDate}|${be.model_id}`)) continue;
      // L3: date + model name (from booking title or CalendarEntry title)
      const beName0 = (be.title ?? '').trim().toLowerCase();
      if (beName0 && beDate && coveredDateModelNames.has(`${beDate}|${beName0}`)) continue;
      // L4: stripped name match (removes "Option – ", " – option", etc.)
      if (beName0 && beDate) {
        const stripped0 = stripLifecycleAffixes(beName0);
        if (stripped0 && coveredDateModelNames.has(`${beDate}|${stripped0}`)) continue;
        if (stripped0 && coveredDateStrippedNames.has(`${beDate}|${stripped0}`)) continue;
      }
      // L5: check if any option row's model_name appears inside the booking title
      if (beName0 && beDate && datesWithOptions.has(beDate)) {
        const dateNames0 = namesByDate.get(beDate);
        if (dateNames0?.some((n) => n && beName0.includes(n))) continue;
      }
      // L6: stripped booking name is substring of any option model_name (reverse)
      if (beName0 && beDate && datesWithOptions.has(beDate)) {
        const stripped0 = stripLifecycleAffixes(beName0);
        if (stripped0) {
          const dateNames0 = namesByDate.get(beDate);
          if (dateNames0?.some((n) => n && n.includes(stripped0))) continue;
        }
      }
    }

    const date = beDate;
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

  const manualRows: UnifiedAgencyCalendarRow[] = manualEvents
    .filter((ev) => {
      const src = ev.source_option_request_id;
      if (src == null || src === '') return true;
      return !coveredOptionIds.has(src);
    })
    .map((ev) => ({
      kind: 'manual' as const,
      sortKey: `${ev.date}\0${ev.title}\0${ev.id}`,
      id: ev.id,
      date: ev.date,
      title: ev.title,
      ev,
    }));

  return [...optionRows, ...bookingRows, ...manualRows];
}

/**
 * When a canonical **job** row from `booking_events` exists (`kind === 'booking'`,
 * `entry_type === 'booking'`, `option_request_id` set), drop the matching option row so
 * the unified list shows a single lifecycle entry (job wins over option + mirror).
 * `coveredOptionIds` in `buildUnifiedAgencyCalendarRows` still uses full `items`, so
 * mirrored `user_calendar_events` stay suppressed.
 */
export function preferJobBookingOverOptionRows(
  rows: UnifiedAgencyCalendarRow[],
): UnifiedAgencyCalendarRow[] {
  const jobBookingOptionIds = new Set<string>();
  for (const r of rows) {
    if (r.kind !== 'booking') continue;
    const e = r.entry;
    const oid = e.option_request_id;
    if (oid && e.entry_type === 'booking') {
      jobBookingOptionIds.add(oid);
    }
  }
  if (jobBookingOptionIds.size === 0) return rows;
  return rows.filter((r) => {
    if (r.kind !== 'option') return true;
    return !jobBookingOptionIds.has(r.item.option.id);
  });
}

/** UI filters only — agency **active representation** (MAT + relationship) is applied when loading in `calendarSupabase` / `AgencyControllerView`. */
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
 * Strip common lifecycle prefixes/suffixes from calendar/booking titles
 * so we can extract the core name (model or client name) for matching.
 *
 * Handles both "Option – Name" (calendar_entry trigger format) and
 * "Name – option" (booking_event trigger / client-side format), with
 * regular hyphens and en-dashes.
 */
function stripLifecycleAffixes(raw: string): string {
  let t = raw;
  const prefixes = [
    'option \u2013 ',
    'casting \u2013 ',
    'job \u2013 ',
    'booking \u2013 ',
    'option - ',
    'casting - ',
    'job - ',
    'booking - ',
  ];
  const suffixes = [
    ' \u2013 option',
    ' \u2013 casting',
    ' \u2013 job',
    ' \u2013 booking',
    ' - option',
    ' - casting',
    ' - job',
    ' - booking',
  ];
  for (const p of prefixes) {
    if (t.startsWith(p)) {
      t = t.slice(p.length);
      break;
    }
  }
  for (const s of suffixes) {
    if (t.endsWith(s)) {
      t = t.slice(0, -s.length);
      break;
    }
  }
  return t.trim();
}

/**
 * Final-pass dedup — booking rows that represent the same lifecycle as an
 * option row are suppressed.  Six layers ensure near-zero false negatives:
 *
 *   K1  option_request_id exact match (authoritative)
 *   K2  date + model_id composite
 *   K3  date + exact normalised name
 *   K4  date + stripped name (prefix/suffix removed)
 *   K5  option model_name is substring of booking title
 *   K6  stripped booking name is substring of any option model_name (reverse)
 *
 * Two genuinely different events for the same model on the same date both
 * arrive through the option_requests path, so suppressing booking rows
 * whose lifecycle key matches an option row is always safe.
 */
export function dedupeUnifiedRowsByOptionRequest(
  rows: UnifiedAgencyCalendarRow[],
): UnifiedAgencyCalendarRow[] {
  const optionIdKeys = new Set<string>();
  const optionDateModelKeys = new Set<string>();
  const optionDateNameKeys = new Set<string>();
  const optionDateStrippedKeys = new Set<string>();
  const datesWithOptions = new Set<string>();

  for (const r of rows) {
    if (r.kind !== 'option') continue;
    const opt = r.item.option;
    if (r.date) datesWithOptions.add(r.date);

    optionIdKeys.add(opt.id);
    const ceId = r.item.calendar_entry?.option_request_id;
    if (ceId && ceId !== opt.id) optionIdKeys.add(ceId);

    if (opt.model_id && r.date) {
      optionDateModelKeys.add(`${r.date}|${opt.model_id}`);
    }

    const name = (opt.model_name ?? '').trim().toLowerCase();
    if (name && r.date) {
      optionDateNameKeys.add(`${r.date}|${name}`);
      const stripped = stripLifecycleAffixes(name);
      if (stripped && stripped !== name) {
        optionDateStrippedKeys.add(`${r.date}|${stripped}`);
      }
    }

    const ceTitle = (r.item.calendar_entry?.title ?? '').trim().toLowerCase();
    if (ceTitle && r.date) {
      const ceStripped = stripLifecycleAffixes(ceTitle);
      if (ceStripped) optionDateStrippedKeys.add(`${r.date}|${ceStripped}`);
    }
  }

  return rows.filter((r) => {
    if (r.kind !== 'booking') return true;
    const e = r.entry;
    const eDate = e.date ?? '';

    // K1: option_request_id
    if (e.option_request_id && optionIdKeys.has(e.option_request_id)) return false;

    // K2: date + model_id
    if (e.model_id && eDate && optionDateModelKeys.has(`${eDate}|${e.model_id}`)) return false;

    const eName = (e.title ?? '').trim().toLowerCase();

    // K3: exact name match
    if (eName && eDate && optionDateNameKeys.has(`${eDate}|${eName}`)) return false;

    // K4: stripped name match (removes "Option – ", " – option", etc.)
    if (eName && eDate) {
      const stripped = stripLifecycleAffixes(eName);
      if (stripped && optionDateNameKeys.has(`${eDate}|${stripped}`)) return false;
      if (stripped && optionDateStrippedKeys.has(`${eDate}|${stripped}`)) return false;
    }

    // K5: any option model_name is a substring of the booking title
    if (eName && eDate && datesWithOptions.has(eDate)) {
      for (const k of optionDateNameKeys) {
        if (!k.startsWith(`${eDate}|`)) continue;
        const justName = k.slice(eDate.length + 1);
        if (justName && eName.includes(justName)) return false;
      }
    }

    // K6: stripped booking name is a substring of any option model_name (reverse)
    if (eName && eDate && datesWithOptions.has(eDate)) {
      const stripped = stripLifecycleAffixes(eName);
      if (stripped) {
        for (const k of optionDateNameKeys) {
          if (!k.startsWith(`${eDate}|`)) continue;
          const justName = k.slice(eDate.length + 1);
          if (justName && justName.includes(stripped)) return false;
        }
      }
    }

    return true;
  });
}

/** Month grid dots — must match list filtering (same ids as unified rows). */
export function buildEventsByDateFromUnifiedRows(rows: UnifiedAgencyCalendarRow[]): Record<
  string,
  Array<{
    id: string;
    color: string;
    title: string;
    kind?: string;
    optionRequestId?: string | null;
  }>
> {
  const map: Record<
    string,
    Array<{
      id: string;
      color: string;
      title: string;
      kind?: string;
      optionRequestId?: string | null;
    }>
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
    if (row.entry.entry_type === 'booking') {
      const tentative = row.entry.status === 'tentative';
      color = tentative ? CALENDAR_COLORS.option : CALENDAR_COLORS.job;
    } else if (row.entry.entry_type === 'casting' || row.entry.entry_type === 'gosee')
      color = colors.textSecondary;
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
