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

function row(agencyId: string, territories: string[], agencyName = 'Agency'): ModelAgencyRow {
  const sorted = [...territories].map((t) => t.toUpperCase()).sort();
  return {
    modelId: 'model-1',
    agencyId,
    agencyName,
    organizationId: `org-${agencyId}`,
    territories: sorted,
    territory: sorted[0] ?? '',
  };
}

describe('makeModelAgencyKey / parseModelAgencyKey', () => {
  it('uses agency UUID as canonical key', () => {
    expect(makeModelAgencyKey(A1)).toBe(A1);
    expect(parseModelAgencyKey(A1)).toEqual({ agencyId: A1 });
  });

  it('parses legacy composite key to agencyId', () => {
    expect(parseModelAgencyKey(`${A1}:DE`)).toEqual({ agencyId: A1, territoryLegacy: 'DE' });
  });

  it('returns null for invalid key', () => {
    expect(parseModelAgencyKey('not-a-uuid:DE')).toBeNull();
    expect(parseModelAgencyKey('')).toBeNull();
  });
});

describe('resolveStoredRepresentationKey', () => {
  it('resolves agency UUID when row exists', () => {
    const rows = [row(A1, ['DE', 'FR'])];
    expect(resolveStoredRepresentationKey(A1, rows)).toBe(A1);
  });

  it('migrates legacy composite to agency UUID', () => {
    const rows = [row(A1, ['DE', 'FR'])];
    expect(resolveStoredRepresentationKey(`${A1}:FR`, rows)).toBe(A1);
  });

  it('returns null when agency unknown', () => {
    expect(resolveStoredRepresentationKey(A2, [row(A1, ['DE'])])).toBeNull();
  });

  it('returns null when stored is null', () => {
    expect(resolveStoredRepresentationKey(null, [row(A1, ['DE'])])).toBeNull();
  });
});

describe('findRowByKey', () => {
  it('finds row by agency UUID', () => {
    const r = row(A1, ['DE', 'FR']);
    const rows = [r, row(A2, ['GB'])];
    expect(findRowByKey(rows, A1)).toBe(r);
  });

  it('returns null for unknown agency', () => {
    expect(findRowByKey([row(A1, ['DE'])], A2)).toBeNull();
  });
});

describe('countUniqueAgencyIds / canonicalMatRowForAgency / uniqueAgencyRowsForSwitcher', () => {
  it('counts distinct agencies only', () => {
    expect(countUniqueAgencyIds([row(A1, ['DE', 'AT'])])).toBe(1);
    expect(countUniqueAgencyIds([row(A1, ['DE']), row(A2, ['DE'])])).toBe(2);
  });

  it('returns aggregated row for agency', () => {
    const r = row(A1, ['DE', 'AT']);
    expect(canonicalMatRowForAgency([r], A1)?.territories).toEqual(['AT', 'DE']);
  });

  it('sorts switcher list', () => {
    const rows = [row(A1, ['DE'], 'Poetry'), row(A2, ['GB'], 'Other')];
    const u = uniqueAgencyRowsForSwitcher(rows);
    expect(u).toHaveLength(2);
    expect(u.map((r) => r.agencyId).sort()).toEqual([A1, A2].sort());
  });
});

describe('needsAgencySelectionUi', () => {
  it('is false for one agency with multiple territories', () => {
    expect(needsAgencySelectionUi([row(A1, ['DE', 'AT'])])).toBe(false);
  });

  it('is true for two distinct agencies', () => {
    expect(needsAgencySelectionUi([row(A1, ['DE']), row(A2, ['DE'])])).toBe(true);
  });
});

describe('computeInitialRepresentationKey', () => {
  it('returns null for empty rows', () => {
    expect(computeInitialRepresentationKey(null, [])).toBeNull();
  });

  it('auto-picks agency when exactly one agency', () => {
    const rows = [row(A1, ['DE', 'AT'])];
    expect(computeInitialRepresentationKey(null, rows)).toBe(A1);
  });

  it('returns null when multiple agencies and no valid stored key', () => {
    const rows = [row(A1, ['DE']), row(A2, ['FR'])];
    expect(computeInitialRepresentationKey(null, rows)).toBeNull();
  });

  it('respects valid stored agency UUID', () => {
    const rows = [row(A1, ['DE', 'AT'])];
    expect(computeInitialRepresentationKey(A1, rows)).toBe(A1);
  });

  it('matches routing gate: multi-agency null until user selects', () => {
    const rows = [row(A1, ['DE']), row(A2, ['FR'])];
    const key = computeInitialRepresentationKey(null, rows);
    expect(key).toBeNull();
    expect(needsAgencySelectionUi(rows)).toBe(true);
  });

  it('matches routing gate: single-agency multi-territory never needs picker', () => {
    const rows = [row(A1, ['DE', 'AT'])];
    expect(needsAgencySelectionUi(rows)).toBe(false);
    expect(computeInitialRepresentationKey(null, rows)).not.toBeNull();
  });
});
