import {
  makeModelAgencyKey,
  parseModelAgencyKey,
  resolveStoredRepresentationKey,
  findRowByKey,
} from '../modelAgencyKey';
import type { ModelAgencyContext as ModelAgencyRow } from '../../services/modelsSupabase';

const A1 = '11111111-1111-1111-1111-111111111111';
const A2 = '22222222-2222-2222-2222-222222222222';

function row(agencyId: string, territory: string, agencyName = 'Agency'): ModelAgencyRow {
  return {
    modelId: 'model-1',
    agencyId,
    agencyName,
    organizationId: `org-${agencyId}`,
    territory,
  };
}

describe('makeModelAgencyKey / parseModelAgencyKey', () => {
  it('round-trips agencyId and territory', () => {
    const k = makeModelAgencyKey(A1, 'DE');
    expect(k).toBe(`${A1}:DE`);
    expect(parseModelAgencyKey(k)).toEqual({ agencyId: A1, territory: 'DE' });
  });

  it('returns null for invalid key', () => {
    expect(parseModelAgencyKey('not-a-uuid:DE')).toBeNull();
    expect(parseModelAgencyKey(A1)).toBeNull();
  });
});

describe('resolveStoredRepresentationKey', () => {
  it('resolves composite key when row exists', () => {
    const rows = [row(A1, 'DE'), row(A1, 'FR')];
    const k = makeModelAgencyKey(A1, 'FR');
    expect(resolveStoredRepresentationKey(k, rows)).toBe(k);
  });

  it('returns null for composite key with no matching row', () => {
    const rows = [row(A1, 'DE')];
    const k = makeModelAgencyKey(A1, 'FR');
    expect(resolveStoredRepresentationKey(k, rows)).toBeNull();
  });

  it('migrates legacy plain agency UUID when exactly one MAT row', () => {
    const rows = [row(A1, 'DE')];
    expect(resolveStoredRepresentationKey(A1, rows)).toBe(makeModelAgencyKey(A1, 'DE'));
  });

  it('returns null for legacy UUID when multiple rows share agencyId', () => {
    const rows = [row(A1, 'DE'), row(A1, 'FR')];
    expect(resolveStoredRepresentationKey(A1, rows)).toBeNull();
  });

  it('returns null when stored is null', () => {
    expect(resolveStoredRepresentationKey(null, [row(A1, 'DE')])).toBeNull();
  });
});

describe('findRowByKey', () => {
  it('finds row by composite key', () => {
    const r = row(A1, 'FR');
    const rows = [row(A1, 'DE'), r];
    const k = makeModelAgencyKey(A1, 'FR');
    expect(findRowByKey(rows, k)).toBe(r);
  });

  it('returns null for unknown key', () => {
    expect(findRowByKey([row(A1, 'DE')], makeModelAgencyKey(A2, 'DE'))).toBeNull();
  });
});
