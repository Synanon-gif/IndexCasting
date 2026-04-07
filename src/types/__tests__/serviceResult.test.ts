import {
  serviceErr,
  serviceOk,
  serviceOkData,
  serviceResultToStructured,
  structuredServiceErr,
} from '../serviceResult';

describe('serviceResultToStructured', () => {
  it('maps ok without data to structured ok', () => {
    const r = serviceResultToStructured(serviceOk());
    expect(r.ok).toBe(true);
    if (r.ok) expect('data' in r).toBe(false);
  });

  it('maps ok with data to structured ok with data', () => {
    const r = serviceResultToStructured(serviceOkData({ token: 'abc' }));
    expect(r.ok).toBe(true);
    if (r.ok && 'data' in r) expect(r.data).toEqual({ token: 'abc' });
  });

  it('maps error to structured error with default code', () => {
    const r = serviceResultToStructured(serviceErr('nope'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('service_error');
      expect(r.error.message).toBe('nope');
    }
  });

  it('maps error with custom code', () => {
    const r = serviceResultToStructured(serviceErr('bad'), 'claim_failed');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('claim_failed');
      expect(r.error.message).toBe('bad');
    }
  });

  it('round-trips compatible with structuredServiceErr shape', () => {
    const direct = structuredServiceErr('x', 'y');
    const fromLegacy = serviceResultToStructured(serviceErr('y'), 'x');
    expect(fromLegacy).toEqual(direct);
  });
});
