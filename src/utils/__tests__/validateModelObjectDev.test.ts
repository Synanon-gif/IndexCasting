import { devAssertAgencyRosterMatchesEligibility } from '../validateModelObjectDev';

describe('devAssertAgencyRosterMatchesEligibility', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  it('no-ops when matLookupOk is false', () => {
    process.env.NODE_ENV = 'development';
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    devAssertAgencyRosterMatchesEligibility([{ id: 'x', user_id: null }], new Set(), 'ag-1', false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('logs in development when a row violates eligibility', () => {
    process.env.NODE_ENV = 'development';
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    devAssertAgencyRosterMatchesEligibility(
      [{ id: 'ghost', user_id: null }],
      new Set(['other']),
      'ag-1',
      true,
    );
    expect(spy).toHaveBeenCalledWith(
      '[dev] agency roster row violates modelEligibleForAgencyRoster',
      expect.objectContaining({ agencyId: 'ag-1', modelId: 'ghost' }),
    );
  });

  it('no-ops in production', () => {
    process.env.NODE_ENV = 'production';
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    devAssertAgencyRosterMatchesEligibility(
      [{ id: 'ghost', user_id: null }],
      new Set(),
      'ag-1',
      true,
    );
    expect(spy).not.toHaveBeenCalled();
  });
});
