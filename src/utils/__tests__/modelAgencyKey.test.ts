import {
  makeModelAgencyKey,
  parseModelAgencyKey,
  resolveStoredRepresentationKey,
  findRowByKey,
  countUniqueAgencyIds,
  canonicalMatRowForAgency,
  uniqueAgencyRowsForSwitcher,
  needsAgencySelectionUi,
  computeInitialRepresentationKey,
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

describe('countUniqueAgencyIds / canonicalMatRowForAgency / uniqueAgencyRowsForSwitcher', () => {
  it('counts distinct agencies only', () => {
    expect(countUniqueAgencyIds([row(A1, 'DE'), row(A1, 'AT')])).toBe(1);
    expect(countUniqueAgencyIds([row(A1, 'DE'), row(A2, 'DE')])).toBe(2);
  });

  it('picks lexicographically first territory for canonical row', () => {
    const rows = [row(A1, 'DE'), row(A1, 'AT')];
    expect(canonicalMatRowForAgency(rows, A1)?.territory).toBe('AT');
  });

  it('dedupes switcher list to one row per agency', () => {
    const rows = [row(A1, 'DE', 'Poetry'), row(A1, 'AT', 'Poetry'), row(A2, 'GB', 'Other')];
    const u = uniqueAgencyRowsForSwitcher(rows);
    expect(u).toHaveLength(2);
    expect(u.map((r) => r.agencyId).sort()).toEqual([A1, A2].sort());
  });
});

describe('needsAgencySelectionUi', () => {
  it('is false for one agency with multiple territories', () => {
    expect(needsAgencySelectionUi([row(A1, 'DE'), row(A1, 'AT')])).toBe(false);
  });

  it('is true for two distinct agencies', () => {
    expect(needsAgencySelectionUi([row(A1, 'DE'), row(A2, 'DE')])).toBe(true);
  });
});

describe('computeInitialRepresentationKey', () => {
  it('returns null for empty rows', () => {
    expect(computeInitialRepresentationKey(null, [])).toBeNull();
  });

  it('auto-picks canonical MAT when exactly one agency', () => {
    const rows = [row(A1, 'DE'), row(A1, 'AT')];
    expect(computeInitialRepresentationKey(null, rows)).toBe(makeModelAgencyKey(A1, 'AT'));
  });

  it('returns null when multiple agencies and no valid stored key', () => {
    const rows = [row(A1, 'DE'), row(A2, 'FR')];
    expect(computeInitialRepresentationKey(null, rows)).toBeNull();
  });

  it('respects valid stored composite key', () => {
    const rows = [row(A1, 'DE'), row(A1, 'AT')];
    const stored = makeModelAgencyKey(A1, 'DE');
    expect(computeInitialRepresentationKey(stored, rows)).toBe(stored);
  });

  it('matches routing gate: multi-agency null until user selects', () => {
    const rows = [row(A1, 'DE'), row(A2, 'FR')];
    const key = computeInitialRepresentationKey(null, rows);
    expect(key).toBeNull();
    expect(needsAgencySelectionUi(rows)).toBe(true);
  });

  it('matches routing gate: single-agency multi-territory never needs picker', () => {
    const rows = [row(A1, 'DE'), row(A1, 'AT')];
    expect(needsAgencySelectionUi(rows)).toBe(false);
    expect(computeInitialRepresentationKey(null, rows)).not.toBeNull();
  });
});
