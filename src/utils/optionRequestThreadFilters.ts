import { attentionHeaderLabelFromSignals } from './negotiationAttentionLabels';
import { attentionSignalsFromOptionRequestLike } from './optionRequestAttention';
import { applyUnifiedOrgFilter } from './threadFilters';
import type { ClientAssignmentFlag } from '../services/clientAssignmentsSupabase';
import type { OptionRequest } from '../store/optionRequests';

export type OptionRequestTypeFilter = 'all' | 'options' | 'castings' | 'jobs';
export type OptionRequestTimeFilter = 'all' | 'future' | 'past';

export type OptionRequestThreadFilterInput = {
  requests: OptionRequest[];
  msgFilter: 'current' | 'archived';
  archivedIds: Set<string>;
  unifiedOrgFilter: string | null;
  assignmentByClientOrgId: Record<string, ClientAssignmentFlag>;
  currentUserId: string | null;
  attentionFilter: 'all' | 'action_required';
  requestTypeFilter: OptionRequestTypeFilter;
  requestTimeFilter: OptionRequestTimeFilter;
  role: 'agency' | 'client';
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

export function matchesRequestTypeFilter(
  r: { requestType?: string | null; finalStatus?: string | null },
  filter: OptionRequestTypeFilter,
): boolean {
  if (filter === 'all') return true;
  const kind = getRequestKindForFilter(r);
  if (filter === 'jobs') return kind === 'job';
  if (filter === 'castings') return kind === 'casting';
  return kind === 'option';
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

export function matchesTimeFilter(
  r: { date: string; startTime?: string | null; endTime?: string | null },
  filter: OptionRequestTimeFilter,
  now: Date = new Date(),
): boolean {
  if (filter === 'all') return true;
  const past = isOptionRequestPast(r, now);
  return filter === 'past' ? past : !past;
}

/** Client-side list filter — does not mutate store data or archive membership. */
export function filterOptionRequestThreads(input: OptionRequestThreadFilterInput): OptionRequest[] {
  const now = input.now ?? new Date();
  return input.requests.filter((r) => {
    if (
      input.msgFilter === 'archived'
        ? !input.archivedIds.has(r.threadId)
        : input.archivedIds.has(r.threadId)
    ) {
      return false;
    }

    const orgFiltered = applyUnifiedOrgFilter(
      [r],
      input.unifiedOrgFilter,
      input.assignmentByClientOrgId,
      input.currentUserId,
    );
    if (orgFiltered.length === 0) return false;

    if (!matchesRequestTypeFilter(r, input.requestTypeFilter)) return false;
    if (!matchesTimeFilter(r, input.requestTimeFilter, now)) return false;

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
