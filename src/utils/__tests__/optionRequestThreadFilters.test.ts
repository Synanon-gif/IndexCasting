import type { OptionRequest } from '../../store/optionRequests';
import {
  filterOptionRequestThreads,
  getRequestKindForFilter,
  isOptionRequestPast,
  matchesRequestTypeFilter,
  matchesTimeFilter,
} from '../optionRequestThreadFilters';

const baseRequest = (overrides: Partial<OptionRequest> = {}): OptionRequest =>
  ({
    id: 'req-1',
    threadId: 'thread-1',
    modelId: 'model-1',
    modelName: 'Model A',
    clientName: 'Client 1',
    date: '2026-06-01',
    status: 'in_negotiation',
    finalStatus: 'option_pending',
    requestType: 'option',
    clientPriceStatus: 'pending',
    ...overrides,
  }) as OptionRequest;

describe('optionRequestThreadFilters', () => {
  const now = new Date('2026-05-23T12:00:00');

  describe('getRequestKindForFilter / matchesRequestTypeFilter', () => {
    it('classifies jobs by final_status', () => {
      expect(
        getRequestKindForFilter({ requestType: 'casting', finalStatus: 'job_confirmed' }),
      ).toBe('job');
      expect(matchesRequestTypeFilter({ finalStatus: 'job_confirmed' }, 'jobs')).toBe(true);
      expect(matchesRequestTypeFilter({ finalStatus: 'job_confirmed' }, 'castings')).toBe(false);
    });

    it('options exclude job_confirmed castings and options', () => {
      expect(
        matchesRequestTypeFilter(
          { requestType: 'option', finalStatus: 'option_pending' },
          'options',
        ),
      ).toBe(true);
      expect(
        matchesRequestTypeFilter(
          { requestType: 'casting', finalStatus: 'option_pending' },
          'options',
        ),
      ).toBe(false);
      expect(
        matchesRequestTypeFilter(
          { requestType: 'option', finalStatus: 'job_confirmed' },
          'options',
        ),
      ).toBe(false);
    });

    it('castings filter matches non-job casting rows', () => {
      expect(
        matchesRequestTypeFilter(
          { requestType: 'casting', finalStatus: 'option_pending' },
          'castings',
        ),
      ).toBe(true);
      expect(
        matchesRequestTypeFilter(
          { requestType: 'option', finalStatus: 'option_confirmed' },
          'castings',
        ),
      ).toBe(false);
    });
  });

  describe('matchesTimeFilter / isOptionRequestPast', () => {
    it('future excludes past end times', () => {
      const past = baseRequest({ date: '2026-05-20', endTime: '10:00:00' });
      const future = baseRequest({ date: '2026-05-25', startTime: '14:00:00' });
      expect(isOptionRequestPast(past, now)).toBe(true);
      expect(matchesTimeFilter(past, 'future', now)).toBe(false);
      expect(matchesTimeFilter(future, 'future', now)).toBe(true);
      expect(matchesTimeFilter(future, 'past', now)).toBe(false);
    });

    it('uses end time when present', () => {
      const sameDayPast = baseRequest({ date: '2026-05-23', endTime: '09:00:00' });
      const sameDayFuture = baseRequest({ date: '2026-05-23', endTime: '18:00:00' });
      expect(isOptionRequestPast(sameDayPast, now)).toBe(true);
      expect(isOptionRequestPast(sameDayFuture, now)).toBe(false);
    });
  });

  describe('filterOptionRequestThreads', () => {
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
      requestTypeFilter: 'all' as const,
      requestTimeFilter: 'all' as const,
      role: 'agency' as const,
      now,
    };

    it('filters options only', () => {
      const rows = filterOptionRequestThreads({
        ...filterBase,
        requestTypeFilter: 'options',
      });
      expect(rows.map((r) => r.threadId).sort()).toEqual(['opt-future', 'opt-past']);
    });

    it('filters castings only', () => {
      const rows = filterOptionRequestThreads({
        ...filterBase,
        requestTypeFilter: 'castings',
      });
      expect(rows.map((r) => r.threadId)).toEqual(['cast-future']);
    });

    it('filters jobs only', () => {
      const rows = filterOptionRequestThreads({
        ...filterBase,
        requestTypeFilter: 'jobs',
      });
      expect(rows.map((r) => r.threadId)).toEqual(['job-row']);
    });

    it('combines castings + future', () => {
      const rows = filterOptionRequestThreads({
        ...filterBase,
        requestTypeFilter: 'castings',
        requestTimeFilter: 'future',
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
  });
});
