import { attentionHeaderLabelFromSignals } from './negotiationAttentionLabels';
import { attentionSignalsFromOptionRequestLike } from './optionRequestAttention';
import { applyUnifiedOrgFilter, filterByCounterparty } from './threadFilters';
import type { ClientAssignmentFlag } from '../services/clientAssignmentsSupabase';
import type { OptionRequest } from '../store/optionRequests';

export type OptionRequestTypeChip = 'options' | 'castings' | 'jobs';
export type OptionRequestTimeChip = 'future' | 'past';

export type OptionRequestAssignmentFilters = {
  scope: 'all' | 'mine' | 'unassigned';
  flagLabel: string;
  assignedMemberUserId: string;
};

export type OptionRequestThreadFilterInput = {
  requests: OptionRequest[];
  msgFilter: 'current' | 'archived';
  archivedIds: Set<string>;
  /** Agency: unified client-org / assignment / internal-events dropdown. */
  unifiedOrgFilter?: string | null;
  assignmentByClientOrgId: Record<string, ClientAssignmentFlag>;
  currentUserId: string | null;
  attentionFilter: 'all' | 'action_required';
  /** Empty set = all request types. Multiple chips = OR within this group. */
  typeFilters: ReadonlySet<OptionRequestTypeChip>;
  /** Empty set or both chips active = all time. Single chip = future or past only. */
  timeFilters: ReadonlySet<OptionRequestTimeChip>;
  role: 'agency' | 'client';
  /** Client: filter by agency org id (toggle chips). */
  counterpartyFilter?: string | null;
  /** Client: assignment scope / flag / member filters. */
  assignmentFilters?: OptionRequestAssignmentFilters;
  searchQuery?: string | null;
  /** Client: hide rows outside this org (defense-in-depth). */
  clientOrganizationId?: string | null;
  now?: Date;
};

/** Classify a row for the request-type filter chips (Jobs override request_type). */
export function getRequestKindForFilter(r: {
  requestType?: string | null;
  finalStatus?: string | null;
}): 'option' | 'casting' | 'job' {
  if (r.finalStatus === 'job_confirmed') return 'job';
  if (r.requestType === 'casting') return 'casting';
  return 'option';
}

export function toggleOptionRequestTypeFilter(
  current: ReadonlySet<OptionRequestTypeChip>,
  chip: OptionRequestTypeChip,
): Set<OptionRequestTypeChip> {
  const next = new Set(current);
  if (next.has(chip)) next.delete(chip);
  else next.add(chip);
  return next;
}

export function toggleOptionRequestTimeFilter(
  current: ReadonlySet<OptionRequestTimeChip>,
  chip: OptionRequestTimeChip,
): Set<OptionRequestTimeChip> {
  const next = new Set(current);
  if (next.has(chip)) next.delete(chip);
  else next.add(chip);
  return next;
}

/** OR semantics when one or more type chips are active; empty set = all types. */
export function matchesRequestTypeFilters(
  r: { requestType?: string | null; finalStatus?: string | null },
  filters: ReadonlySet<OptionRequestTypeChip>,
): boolean {
  if (filters.size === 0) return true;
  const kind = getRequestKindForFilter(r);
  if (filters.has('jobs') && kind === 'job') return true;
  if (filters.has('options') && kind === 'option') return true;
  if (filters.has('castings') && kind === 'casting') return true;
  return false;
}

/** End instant of the scheduled slot (local time) — used for past/future list filters. */
export function getOptionRequestEndInstant(
  date: string,
  startTime?: string | null,
  endTime?: string | null,
): Date {
  const datePart = (date ?? '').slice(0, 10);
  const [y, mo, d] = datePart.split('-').map((n) => parseInt(n, 10));
  if (!y || !mo || !d) return new Date(NaN);

  const timeRaw = (endTime ?? startTime ?? '23:59:59').toString();
  const [hh = 23, mm = 59, ss = 59] = timeRaw.split(':').map((n) => parseInt(n, 10));
  return new Date(y, mo - 1, d, hh, mm, ss);
}

export function isOptionRequestPast(
  r: { date: string; startTime?: string | null; endTime?: string | null },
  now: Date = new Date(),
): boolean {
  const end = getOptionRequestEndInstant(r.date, r.startTime, r.endTime);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() < now.getTime();
}

/** Empty or both chips = all time; otherwise future/past only (AND with other filters). */
export function matchesTimeFilters(
  r: { date: string; startTime?: string | null; endTime?: string | null },
  filters: ReadonlySet<OptionRequestTimeChip>,
  now: Date = new Date(),
): boolean {
  if (filters.size === 0 || filters.size === 2) return true;
  const past = isOptionRequestPast(r, now);
  if (filters.has('future') && !past) return true;
  if (filters.has('past') && past) return true;
  return false;
}

export function matchesOptionRequestSearchQuery(
  r: Pick<OptionRequest, 'modelName' | 'clientName'>,
  searchQuery: string | null | undefined,
): boolean {
  const q = (searchQuery ?? '').trim().toLowerCase();
  if (!q) return true;
  return (
    (r.modelName ?? '').toLowerCase().includes(q) || (r.clientName ?? '').toLowerCase().includes(q)
  );
}

export function matchesClientAssignmentFilters(
  r: OptionRequest,
  filters: OptionRequestAssignmentFilters | undefined,
  assignmentByClientOrgId: Record<string, ClientAssignmentFlag>,
  currentUserId: string | null,
): boolean {
  if (!filters) return true;
  const assignment = r.clientOrganizationId
    ? assignmentByClientOrgId[r.clientOrganizationId]
    : undefined;
  if (filters.scope === 'mine' && assignment?.assignedMemberUserId !== currentUserId) return false;
  if (filters.scope === 'unassigned' && !!assignment?.assignedMemberUserId) return false;
  if (
    filters.flagLabel !== 'all' &&
    (assignment?.label ?? '').toLowerCase() !== filters.flagLabel.toLowerCase()
  ) {
    return false;
  }
  if (
    filters.assignedMemberUserId !== 'all' &&
    assignment?.assignedMemberUserId !== filters.assignedMemberUserId
  ) {
    return false;
  }
  return true;
}

/** Client-side list filter — does not mutate store data or archive membership. */
export function filterOptionRequestThreads(input: OptionRequestThreadFilterInput): OptionRequest[] {
  const now = input.now ?? new Date();
  const unifiedOrgFilter = input.unifiedOrgFilter ?? null;
  const counterpartyFilter = input.counterpartyFilter ?? null;

  return input.requests.filter((r) => {
    if (input.role === 'client') {
      if (r.isAgencyOnly) return false;
      if (
        input.clientOrganizationId &&
        r.clientOrganizationId &&
        r.clientOrganizationId !== input.clientOrganizationId
      ) {
        return false;
      }
    }

    if (
      input.msgFilter === 'archived'
        ? !input.archivedIds.has(r.threadId)
        : input.archivedIds.has(r.threadId)
    ) {
      return false;
    }

    if (input.role === 'agency') {
      const orgFiltered = applyUnifiedOrgFilter(
        [r],
        unifiedOrgFilter,
        input.assignmentByClientOrgId,
        input.currentUserId,
      );
      if (orgFiltered.length === 0) return false;
    } else if (counterpartyFilter) {
      const cpFiltered = filterByCounterparty([r], 'client', counterpartyFilter);
      if (cpFiltered.length === 0) return false;
    }

    if (!matchesOptionRequestSearchQuery(r, input.searchQuery)) return false;

    if (
      !matchesClientAssignmentFilters(
        r,
        input.role === 'client' ? input.assignmentFilters : undefined,
        input.assignmentByClientOrgId,
        input.currentUserId,
      )
    ) {
      return false;
    }

    if (!matchesRequestTypeFilters(r, input.typeFilters)) return false;
    if (!matchesTimeFilters(r, input.timeFilters, now)) return false;

    if (input.attentionFilter === 'action_required') {
      const sig = attentionSignalsFromOptionRequestLike({
        status: r.status,
        finalStatus: r.finalStatus ?? null,
        clientPriceStatus: r.clientPriceStatus ?? null,
        modelApproval: r.modelApproval,
        modelAccountLinked: r.modelAccountLinked ?? false,
        agencyCounterPrice: r.agencyCounterPrice ?? null,
        proposedPrice: r.proposedPrice ?? null,
        isAgencyOnly: r.isAgencyOnly ?? false,
        requestType: r.requestType ?? null,
      });
      if (!attentionHeaderLabelFromSignals(sig, input.role)) return false;
    }

    return true;
  });
}
