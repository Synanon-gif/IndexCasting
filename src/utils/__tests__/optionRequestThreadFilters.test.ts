import type { OptionRequest } from '../../store/optionRequests';
import {
  filterOptionRequestThreads,
  getRequestKindForFilter,
  isOptionRequestPast,
  matchesRequestTypeFilters,
  matchesTimeFilters,
  toggleOptionRequestTimeFilter,
  toggleOptionRequestTypeFilter,
} from '../optionRequestThreadFilters';

const baseRequest = (overrides: Partial<OptionRequest> = {}): OptionRequest =>
  ({
    id: 'req-1',
    threadId: 'thread-1',
    modelId: 'model-1',
    modelName: 'Model A',
    clientName: 'Client 1',
    clientOrganizationId: 'client-org-a',
    date: '2026-06-01',
    status: 'in_negotiation',
    finalStatus: 'option_pending',
    requestType: 'option',
    clientPriceStatus: 'pending',
    ...overrides,
  }) as OptionRequest;

const typeSet = (...chips: ('options' | 'castings' | 'jobs')[]) => new Set(chips);
const timeSet = (...chips: ('future' | 'past')[]) => new Set(chips);

describe('optionRequestThreadFilters', () => {
  const now = new Date('2026-05-23T12:00:00');

  describe('getRequestKindForFilter / matchesRequestTypeFilters', () => {
    it('classifies jobs by final_status', () => {
      expect(
        getRequestKindForFilter({ requestType: 'casting', finalStatus: 'job_confirmed' }),
      ).toBe('job');
      expect(matchesRequestTypeFilters({ finalStatus: 'job_confirmed' }, typeSet('jobs'))).toBe(
        true,
      );
      expect(matchesRequestTypeFilters({ finalStatus: 'job_confirmed' }, typeSet('castings'))).toBe(
        false,
      );
    });

    it('options exclude job_confirmed castings and options', () => {
      expect(
        matchesRequestTypeFilters(
          { requestType: 'option', finalStatus: 'option_pending' },
          typeSet('options'),
        ),
      ).toBe(true);
      expect(
        matchesRequestTypeFilters(
          { requestType: 'casting', finalStatus: 'option_pending' },
          typeSet('options'),
        ),
      ).toBe(false);
      expect(
        matchesRequestTypeFilters(
          { requestType: 'option', finalStatus: 'job_confirmed' },
          typeSet('options'),
        ),
      ).toBe(false);
    });

    it('castings filter matches non-job casting rows', () => {
      expect(
        matchesRequestTypeFilters(
          { requestType: 'casting', finalStatus: 'option_pending' },
          typeSet('castings'),
        ),
      ).toBe(true);
      expect(
        matchesRequestTypeFilters(
          { requestType: 'option', finalStatus: 'option_confirmed' },
          typeSet('castings'),
        ),
      ).toBe(false);
    });

    it('empty type filters = all types', () => {
      expect(matchesRequestTypeFilters({ requestType: 'casting' }, new Set())).toBe(true);
      expect(matchesRequestTypeFilters({ finalStatus: 'job_confirmed' }, new Set())).toBe(true);
    });

    it('options + castings OR shows both but not jobs', () => {
      const filters = typeSet('options', 'castings');
      expect(
        matchesRequestTypeFilters(
          { requestType: 'option', finalStatus: 'option_pending' },
          filters,
        ),
      ).toBe(true);
      expect(
        matchesRequestTypeFilters(
          { requestType: 'casting', finalStatus: 'option_pending' },
          filters,
        ),
      ).toBe(true);
      expect(
        matchesRequestTypeFilters({ finalStatus: 'job_confirmed', requestType: 'option' }, filters),
      ).toBe(false);
    });
  });

  describe('toggleOptionRequestTypeFilter / toggleOptionRequestTimeFilter', () => {
    it('toggles chips on and off', () => {
      expect(toggleOptionRequestTypeFilter(new Set(), 'options')).toEqual(new Set(['options']));
      expect(toggleOptionRequestTypeFilter(new Set(['options']), 'options')).toEqual(new Set());
      expect(toggleOptionRequestTimeFilter(new Set(['future']), 'past')).toEqual(
        new Set(['future', 'past']),
      );
    });
  });

  describe('matchesTimeFilters / isOptionRequestPast', () => {
    it('future excludes past end times', () => {
      const past = baseRequest({ date: '2026-05-20', endTime: '10:00:00' });
      const future = baseRequest({ date: '2026-05-25', startTime: '14:00:00' });
      expect(isOptionRequestPast(past, now)).toBe(true);
      expect(matchesTimeFilters(past, timeSet('future'), now)).toBe(false);
      expect(matchesTimeFilters(future, timeSet('future'), now)).toBe(true);
      expect(matchesTimeFilters(future, timeSet('past'), now)).toBe(false);
    });

    it('uses end time when present', () => {
      const sameDayPast = baseRequest({ date: '2026-05-23', endTime: '09:00:00' });
      const sameDayFuture = baseRequest({ date: '2026-05-23', endTime: '18:00:00' });
      expect(isOptionRequestPast(sameDayPast, now)).toBe(true);
      expect(isOptionRequestPast(sameDayFuture, now)).toBe(false);
    });

    it('future + past active = all time', () => {
      const past = baseRequest({ date: '2026-04-01', endTime: '12:00:00' });
      const future = baseRequest({ date: '2026-06-01' });
      const both = timeSet('future', 'past');
      expect(matchesTimeFilters(past, both, now)).toBe(true);
      expect(matchesTimeFilters(future, both, now)).toBe(true);
      expect(matchesTimeFilters(past, new Set(), now)).toBe(true);
    });
  });

  describe('filterOptionRequestThreads — agency', () => {
    const requests = [
      baseRequest({ threadId: 'opt-future', requestType: 'option', date: '2026-06-01' }),
      baseRequest({
        threadId: 'cast-future',
        requestType: 'casting',
        date: '2026-06-02',
        modelName: 'Cast Model',
      }),
      baseRequest({
        threadId: 'job-row',
        requestType: 'option',
        finalStatus: 'job_confirmed',
        status: 'confirmed',
        date: '2026-04-01',
      }),
      baseRequest({
        threadId: 'opt-past',
        requestType: 'option',
        date: '2026-04-01',
        endTime: '12:00:00',
      }),
    ];

    const filterBase = {
      requests,
      msgFilter: 'current' as const,
      archivedIds: new Set<string>(),
      unifiedOrgFilter: null,
      assignmentByClientOrgId: {},
      currentUserId: null,
      attentionFilter: 'all' as const,
      typeFilters: new Set<'options' | 'castings' | 'jobs'>(),
      timeFilters: new Set<'future' | 'past'>(),
      role: 'agency' as const,
      now,
    };

    it('1 agency: no type filters shows all', () => {
      expect(
        filterOptionRequestThreads(filterBase)
          .map((r) => r.threadId)
          .sort(),
      ).toEqual(['cast-future', 'job-row', 'opt-future', 'opt-past']);
    });

    it('6 agency: options + castings shows both but no jobs', () => {
      const rows = filterOptionRequestThreads({
        ...filterBase,
        typeFilters: typeSet('options', 'castings'),
      });
      expect(rows.map((r) => r.threadId).sort()).toEqual(['cast-future', 'opt-future', 'opt-past']);
    });

    it('filters options only', () => {
      const rows = filterOptionRequestThreads({
        ...filterBase,
        typeFilters: typeSet('options'),
      });
      expect(rows.map((r) => r.threadId).sort()).toEqual(['opt-future', 'opt-past']);
    });

    it('filters castings only', () => {
      const rows = filterOptionRequestThreads({
        ...filterBase,
        typeFilters: typeSet('castings'),
      });
      expect(rows.map((r) => r.threadId)).toEqual(['cast-future']);
    });

    it('filters jobs only', () => {
      const rows = filterOptionRequestThreads({
        ...filterBase,
        typeFilters: typeSet('jobs'),
      });
      expect(rows.map((r) => r.threadId)).toEqual(['job-row']);
    });

    it('combines castings + future', () => {
      const rows = filterOptionRequestThreads({
        ...filterBase,
        typeFilters: typeSet('castings'),
        timeFilters: timeSet('future'),
      });
      expect(rows.map((r) => r.threadId)).toEqual(['cast-future']);
    });

    it('respects archived current filter', () => {
      const rows = filterOptionRequestThreads({
        ...filterBase,
        archivedIds: new Set(['opt-past']),
      });
      expect(rows.some((r) => r.threadId === 'opt-past')).toBe(false);
    });

    it('9 combines search with type filters', () => {
      const rows = filterOptionRequestThreads({
        ...filterBase,
        typeFilters: typeSet('options'),
        searchQuery: 'Cast',
      });
      expect(rows).toHaveLength(0);
      const rows2 = filterOptionRequestThreads({
        ...filterBase,
        typeFilters: typeSet('castings'),
        searchQuery: 'Cast',
      });
      expect(rows2.map((r) => r.threadId)).toEqual(['cast-future']);
    });
  });

  describe('filterOptionRequestThreads — client', () => {
    const clientOrgId = 'client-org-a';
    const otherOrgId = 'client-org-b';
    const agencyA = 'agency-org-a';
    const agencyB = 'agency-org-b';

    const requests = [
      baseRequest({
        threadId: 'client-opt-future',
        requestType: 'option',
        date: '2026-06-01',
        clientOrganizationId: clientOrgId,
        agencyOrganizationId: agencyA,
      }),
      baseRequest({
        threadId: 'client-cast-future',
        requestType: 'casting',
        date: '2026-06-02',
        clientOrganizationId: clientOrgId,
        agencyOrganizationId: agencyA,
      }),
      baseRequest({
        threadId: 'client-job-past',
        requestType: 'option',
        finalStatus: 'job_confirmed',
        status: 'confirmed',
        date: '2026-04-01',
        endTime: '10:00:00',
        clientOrganizationId: clientOrgId,
        agencyOrganizationId: agencyA,
      }),
      baseRequest({
        threadId: 'client-opt-past',
        requestType: 'option',
        date: '2026-04-01',
        endTime: '12:00:00',
        clientOrganizationId: clientOrgId,
        agencyOrganizationId: agencyB,
      }),
      baseRequest({
        threadId: 'agency-only-internal',
        isAgencyOnly: true,
        requestType: 'option',
        date: '2026-06-03',
        clientOrganizationId: clientOrgId,
      }),
      baseRequest({
        threadId: 'cross-org-leak',
        requestType: 'option',
        date: '2026-06-04',
        clientOrganizationId: otherOrgId,
        agencyOrganizationId: agencyA,
      }),
    ];

    const filterBase = {
      requests,
      msgFilter: 'current' as const,
      archivedIds: new Set<string>(),
      assignmentByClientOrgId: {},
      currentUserId: 'user-1',
      attentionFilter: 'all' as const,
      typeFilters: new Set<'options' | 'castings' | 'jobs'>(),
      timeFilters: new Set<'future' | 'past'>(),
      role: 'client' as const,
      clientOrganizationId: clientOrgId,
      now,
    };

    it('1 client: options filter shows only options', () => {
      const rows = filterOptionRequestThreads({
        ...filterBase,
        typeFilters: typeSet('options'),
      });
      expect(rows.map((r) => r.threadId).sort()).toEqual(['client-opt-future', 'client-opt-past']);
    });

    it('2 client: castings filter shows only castings', () => {
      const rows = filterOptionRequestThreads({
        ...filterBase,
        typeFilters: typeSet('castings'),
      });
      expect(rows.map((r) => r.threadId)).toEqual(['client-cast-future']);
    });

    it('3 client: jobs filter shows job_confirmed', () => {
      const rows = filterOptionRequestThreads({
        ...filterBase,
        typeFilters: typeSet('jobs'),
      });
      expect(rows.map((r) => r.threadId)).toEqual(['client-job-past']);
    });

    it('4 client: future + castings combined', () => {
      const rows = filterOptionRequestThreads({
        ...filterBase,
        typeFilters: typeSet('castings'),
        timeFilters: timeSet('future'),
      });
      expect(rows.map((r) => r.threadId)).toEqual(['client-cast-future']);
    });

    it('5 client: past + jobs combined', () => {
      const rows = filterOptionRequestThreads({
        ...filterBase,
        typeFilters: typeSet('jobs'),
        timeFilters: timeSet('past'),
      });
      expect(rows.map((r) => r.threadId)).toEqual(['client-job-past']);
    });

    it('11 client never sees agency-only requests', () => {
      const rows = filterOptionRequestThreads(filterBase);
      expect(rows.some((r) => r.threadId === 'agency-only-internal')).toBe(false);
    });

    it('12 cross-org requests stay hidden', () => {
      const rows = filterOptionRequestThreads(filterBase);
      expect(rows.some((r) => r.threadId === 'cross-org-leak')).toBe(false);
    });

    it('10 archived mode independent of type/time', () => {
      const archived = filterOptionRequestThreads({
        ...filterBase,
        msgFilter: 'archived',
        archivedIds: new Set(['client-opt-past']),
        typeFilters: typeSet('options'),
      });
      expect(archived.map((r) => r.threadId)).toEqual(['client-opt-past']);
      const current = filterOptionRequestThreads({
        ...filterBase,
        archivedIds: new Set(['client-opt-past']),
        typeFilters: typeSet('options'),
      });
      expect(current.some((r) => r.threadId === 'client-opt-past')).toBe(false);
    });

    it('counterparty filter combines with type filters', () => {
      const rows = filterOptionRequestThreads({
        ...filterBase,
        typeFilters: typeSet('options'),
        counterpartyFilter: agencyB,
      });
      expect(rows.map((r) => r.threadId)).toEqual(['client-opt-past']);
    });

    it('9 attention filter combines with type filters', () => {
      const attentionRequests = [
        baseRequest({
          threadId: 'needs-action-opt',
          requestType: 'option',
          date: '2026-06-01',
          clientOrganizationId: clientOrgId,
          clientPriceStatus: 'pending',
          finalStatus: 'option_pending',
          modelApproval: 'approved',
        }),
        baseRequest({
          threadId: 'no-action-cast',
          requestType: 'casting',
          date: '2026-06-02',
          clientOrganizationId: clientOrgId,
          finalStatus: 'option_confirmed',
          modelApproval: 'approved',
          status: 'confirmed',
        }),
      ];
      const rows = filterOptionRequestThreads({
        ...filterBase,
        requests: attentionRequests,
        typeFilters: typeSet('options'),
        attentionFilter: 'action_required',
      });
      expect(rows.map((r) => r.threadId)).toEqual(['needs-action-opt']);
    });
  });
});
