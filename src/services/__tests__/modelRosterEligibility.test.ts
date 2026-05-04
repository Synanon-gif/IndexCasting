import { modelEligibleForAgencyRoster } from '../../utils/modelRosterEligibility';

describe('modelEligibleForAgencyRoster', () => {
  const mat = new Set(['m1', 'm2']);

  it('includes linked models when they have MAT for this agency', () => {
    expect(modelEligibleForAgencyRoster({ id: 'm1', user_id: 'u1' }, mat)).toBe(true);
  });

  it('excludes linked models without MAT (stale agency_id / post-remove)', () => {
    expect(modelEligibleForAgencyRoster({ id: 'orphan', user_id: 'u1' }, mat)).toBe(false);
  });

  it('includes unlinked models that have MAT for this agency', () => {
    expect(modelEligibleForAgencyRoster({ id: 'm1', user_id: null }, mat)).toBe(true);
  });

  it('excludes unlinked models with no MAT for this agency', () => {
    expect(modelEligibleForAgencyRoster({ id: 'ghost', user_id: null }, mat)).toBe(false);
  });

  it('excludes ended relationship even if MAT set is unexpectedly stale', () => {
    expect(
      modelEligibleForAgencyRoster({ id: 'm1', agency_relationship_status: 'ended' }, mat),
    ).toBe(false);
  });
});
