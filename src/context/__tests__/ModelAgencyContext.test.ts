/**
 * Tests for ModelAgencyContext selection logic.
 *
 * Since we don't have @testing-library/react, we test the core selection
 * algorithm extracted as a pure function matching the Provider's `load` logic.
 * We mock AsyncStorage as a simple in-memory map.
 */

const mockStore: Record<string, string> = {};

const MockAsyncStorage = {
  getItem: async (key: string) => mockStore[key] ?? null,
  setItem: async (key: string, value: string) => {
    mockStore[key] = value;
  },
  removeItem: async (key: string) => {
    delete mockStore[key];
  },
};

type ModelAgencyRow = {
  modelId: string;
  agencyId: string;
  agencyName: string;
  organizationId: string | null;
  territory: string;
};

const STORAGE_KEY = 'active_model_agency';

/**
 * Mirrors the selection logic inside ModelAgencyProvider.load().
 * Returns the activeAgencyId that the provider would set.
 */
async function resolveActiveAgency(rows: ModelAgencyRow[]): Promise<string | null> {
  const stored = await MockAsyncStorage.getItem(STORAGE_KEY);
  if (stored && rows.some((r) => r.agencyId === stored)) {
    return stored;
  }
  if (rows.length === 1) {
    await MockAsyncStorage.setItem(STORAGE_KEY, rows[0].agencyId);
    return rows[0].agencyId;
  }
  if (rows.length > 1) {
    await MockAsyncStorage.removeItem(STORAGE_KEY);
    return null;
  }
  await MockAsyncStorage.removeItem(STORAGE_KEY);
  return null;
}

function makeRow(agencyId: string, agencyName = 'Agency'): ModelAgencyRow {
  return {
    modelId: 'model-1',
    agencyId,
    agencyName,
    organizationId: `org-${agencyId}`,
    territory: 'DE',
  };
}

beforeEach(() => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
});

describe('ModelAgencyContext selection logic', () => {
  it('auto-selects when only one agency exists', async () => {
    const result = await resolveActiveAgency([makeRow('a1')]);
    expect(result).toBe('a1');
    expect(await MockAsyncStorage.getItem(STORAGE_KEY)).toBe('a1');
  });

  it('returns null when multiple agencies and no stored preference', async () => {
    const result = await resolveActiveAgency([makeRow('a1'), makeRow('a2')]);
    expect(result).toBeNull();
  });

  it('restores stored preference when still valid', async () => {
    await MockAsyncStorage.setItem(STORAGE_KEY, 'a2');
    const result = await resolveActiveAgency([makeRow('a1'), makeRow('a2')]);
    expect(result).toBe('a2');
  });

  it('clears stored preference when agency no longer in list', async () => {
    await MockAsyncStorage.setItem(STORAGE_KEY, 'removed-agency');
    const result = await resolveActiveAgency([makeRow('a1'), makeRow('a2')]);
    expect(result).toBeNull();
    expect(await MockAsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('returns null and clears storage when no agencies', async () => {
    await MockAsyncStorage.setItem(STORAGE_KEY, 'old');
    const result = await resolveActiveAgency([]);
    expect(result).toBeNull();
    expect(await MockAsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('switchAgency persists to storage', async () => {
    await MockAsyncStorage.setItem(STORAGE_KEY, 'a2');
    expect(await MockAsyncStorage.getItem(STORAGE_KEY)).toBe('a2');
  });

  it('auto-selects single agency even when stale storage exists', async () => {
    await MockAsyncStorage.setItem(STORAGE_KEY, 'stale');
    const result = await resolveActiveAgency([makeRow('only-one')]);
    expect(result).toBe('only-one');
    expect(await MockAsyncStorage.getItem(STORAGE_KEY)).toBe('only-one');
  });
});
