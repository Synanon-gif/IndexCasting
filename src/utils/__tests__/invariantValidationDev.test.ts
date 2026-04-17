import {
  findDuplicateActiveCalendarEntriesByOptionRequestDev,
  validateAgencyAggregationDuplicatesDev,
  validateLocationDisplayDriftHintDev,
  validateRosterMatMembershipIssues,
} from '../invariantValidationDev';

describe('invariantValidationDev (pure)', () => {
  describe('validateRosterMatMembershipIssues', () => {
    it('returns empty when all models are in MAT set', () => {
      expect(
        validateRosterMatMembershipIssues([{ id: 'a' }, { id: 'b' }], new Set(['a', 'b'])),
      ).toEqual([]);
    });

    it('flags models missing from MAT set', () => {
      expect(validateRosterMatMembershipIssues([{ id: 'ghost' }], new Set(['other']))).toEqual([
        { modelId: 'ghost', code: 'missing_mat' },
      ]);
    });
  });

  describe('findDuplicateActiveCalendarEntriesByOptionRequestDev', () => {
    it('ignores cancelled and missing option_request_id', () => {
      expect(
        findDuplicateActiveCalendarEntriesByOptionRequestDev([
          { id: '1', option_request_id: 'opt-1', status: 'cancelled' },
          { id: '2', option_request_id: 'opt-1', status: 'tentative' },
        ]),
      ).toEqual([]);
    });

    it('detects two active rows for same option', () => {
      const d = findDuplicateActiveCalendarEntriesByOptionRequestDev([
        { id: 'a', option_request_id: 'opt-1', status: 'tentative' },
        { id: 'b', option_request_id: 'opt-1', status: 'booked' },
      ]);
      expect(d).toEqual([{ optionRequestId: 'opt-1', entryIds: ['a', 'b'] }]);
    });
  });

  describe('validateAgencyAggregationDuplicatesDev', () => {
    it('flags duplicate model+agency pairs', () => {
      expect(
        validateAgencyAggregationDuplicatesDev([
          { modelId: 'm1', agencyId: 'ag1' },
          { modelId: 'm1', agencyId: 'ag1' },
        ]),
      ).toEqual([{ modelId: 'm1', agencyId: 'ag1', count: 2 }]);
    });

    it('allows same model with two agencies', () => {
      expect(
        validateAgencyAggregationDuplicatesDev([
          { modelId: 'm1', agencyId: 'ag1' },
          { modelId: 'm1', agencyId: 'ag2' },
        ]),
      ).toEqual([]);
    });
  });

  describe('validateLocationDisplayDriftHintDev', () => {
    it('no drift when equal or one empty', () => {
      expect(
        validateLocationDisplayDriftHintDev({ effective_city: 'Paris', city: 'Paris' }),
      ).toEqual({
        drift: false,
      });
      expect(validateLocationDisplayDriftHintDev({ effective_city: '', city: 'Paris' })).toEqual({
        drift: false,
      });
    });

    it('hints drift when both set and unrelated', () => {
      const r = validateLocationDisplayDriftHintDev({
        effective_city: 'Berlin',
        city: 'Lisbon',
      });
      expect(r.drift).toBe(true);
      expect(r.reason).toContain('canonicalDisplayCityForModel');
    });
  });
});
