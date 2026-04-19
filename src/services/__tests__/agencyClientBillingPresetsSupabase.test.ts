/**
 * Tests for agencyClientBillingPresetsSupabase.ts (Agency × Client billing presets).
 *
 * Coverage:
 *   - listAgencyClientBillingPresets (assertOrgContext + filter by client_organization_id)
 *   - getDefaultPresetForClient (returns single default; null when none)
 *   - getAgencyClientBillingPreset (single fetch)
 *   - createAgencyClientBillingPreset (first preset auto-default; clears siblings on is_default)
 *   - updateAgencyClientBillingPreset (no-op patch; is_default flip clears siblings)
 *   - deleteAgencyClientBillingPreset (scoped by agency_organization_id)
 *
 * Invariants asserted:
 *   - Option A: never throws; returns false / null / [] on error.
 *   - assertOrgContext: empty agencyOrganizationId is caught early (no DB call).
 *   - Sibling-clear runs BEFORE insert/update when is_default = true.
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';
import {
  listAgencyClientBillingPresets,
  getDefaultPresetForClient,
  getAgencyClientBillingPreset,
  createAgencyClientBillingPreset,
  updateAgencyClientBillingPreset,
  deleteAgencyClientBillingPreset,
} from '../agencyClientBillingPresetsSupabase';

const from = supabase.from as jest.Mock;

let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.resetAllMocks();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * select('*').eq().order().order().order().limit() — limit returns thenable + .eq()
 */
const listChain = (result: unknown) => {
  const eqAfter: jest.Mock = jest.fn();
  const buildResolvable = (): {
    eq: jest.Mock;
    then: (cb: (v: unknown) => unknown) => Promise<unknown>;
  } => ({
    eq: eqAfter,
    then: (cb: (v: unknown) => unknown) => Promise.resolve(cb(result)),
  });
  eqAfter.mockImplementation(() => buildResolvable());
  const limit = jest.fn().mockImplementation(() => buildResolvable());
  const order3 = jest.fn().mockReturnValue({ limit });
  const order2 = jest.fn().mockReturnValue({ order: order3 });
  const order1 = jest.fn().mockReturnValue({ order: order2 });
  const eq = jest.fn().mockReturnValue({ order: order1 });
  const select = jest.fn().mockReturnValue({ eq });
  return { select, eq, eqAfter };
};

const maybeSingle3EqChain = (result: unknown) => {
  const maybeSingle = jest.fn().mockResolvedValue(result);
  const eq3 = jest.fn().mockReturnValue({ maybeSingle });
  const eq2 = jest.fn().mockReturnValue({ eq: eq3 });
  const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
  const select = jest.fn().mockReturnValue({ eq: eq1 });
  return { select, eq1, eq2, eq3, maybeSingle };
};

const maybeSingle1EqChain = (result: unknown) => {
  const maybeSingle = jest.fn().mockResolvedValue(result);
  const eq = jest.fn().mockReturnValue({ maybeSingle });
  const select = jest.fn().mockReturnValue({ eq });
  return { select, eq, maybeSingle };
};

const insertReturningChain = (result: unknown) => {
  const single = jest.fn().mockResolvedValue(result);
  const select = jest.fn().mockReturnValue({ single });
  const insert = jest.fn().mockReturnValue({ select });
  return { insert, select, single };
};

const updateEqEqChain = (result: { error: unknown }) => {
  const second = jest.fn().mockResolvedValue(result);
  const first = jest.fn().mockReturnValue({ eq: second });
  const update = jest.fn().mockReturnValue({ eq: first });
  return { update, first, second };
};

const deleteEqEqChain = (result: { error: unknown }) => {
  const second = jest.fn().mockResolvedValue(result);
  const first = jest.fn().mockReturnValue({ eq: second });
  const del = jest.fn().mockReturnValue({ eq: first });
  return { delete: del, first, second };
};

/**
 * select('id', { count, head }).eq().eq() -> { count, error }
 */
const countChain = (result: { count: number | null; error: unknown }) => {
  const eq2 = jest.fn().mockResolvedValue(result);
  const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
  const select = jest.fn().mockReturnValue({ eq: eq1 });
  return { select, eq1, eq2 };
};

/**
 * .update({...}).eq().eq().eq().neq() -> { error }
 * Used by clearDefaultExcept when exceptPresetId is provided.
 */
const clearDefaultChain = (result: { error: unknown }) => {
  const neq = jest.fn().mockResolvedValue(result);
  const eq3 = jest.fn().mockReturnValue({ neq });
  const eq2 = jest.fn().mockReturnValue({ eq: eq3 });
  const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
  const update = jest.fn().mockReturnValue({ eq: eq1 });
  return { update, eq1, eq2, eq3, neq };
};

/**
 * .update({...}).eq().eq().eq() -> { error }
 * Used by clearDefaultExcept when exceptPresetId is null.
 */
const clearDefaultNoNeqChain = (result: { error: unknown }) => {
  const eq3 = jest.fn().mockResolvedValue(result);
  const eq2 = jest.fn().mockReturnValue({ eq: eq3 });
  const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
  const update = jest.fn().mockReturnValue({ eq: eq1 });
  return { update, eq1, eq2, eq3 };
};

// ─── listAgencyClientBillingPresets ─────────────────────────────────────────

describe('listAgencyClientBillingPresets', () => {
  it('returns [] when org context missing', async () => {
    expect(await listAgencyClientBillingPresets('')).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('returns rows on success', async () => {
    const chain = listChain({ data: [{ id: 'p1' }, { id: 'p2' }], error: null });
    from.mockReturnValue(chain);
    const r = await listAgencyClientBillingPresets('agency-1');
    expect(r).toHaveLength(2);
    expect(chain.eq).toHaveBeenCalledWith('agency_organization_id', 'agency-1');
  });

  it('returns [] on DB error', async () => {
    from.mockReturnValue(listChain({ data: null, error: { message: 'rls' } }));
    expect(await listAgencyClientBillingPresets('agency-1')).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('filters by clientOrganizationId via second .eq()', async () => {
    const chain = listChain({ data: [], error: null });
    from.mockReturnValue(chain);
    await listAgencyClientBillingPresets('agency-1', { clientOrganizationId: 'client-9' });
    expect(chain.eqAfter).toHaveBeenCalledWith('client_organization_id', 'client-9');
  });
});

// ─── getDefaultPresetForClient ──────────────────────────────────────────────

describe('getDefaultPresetForClient', () => {
  it('returns null when org context missing', async () => {
    expect(await getDefaultPresetForClient('', 'client-1')).toBeNull();
  });

  it('returns null when clientOrganizationId missing', async () => {
    expect(await getDefaultPresetForClient('agency-1', '')).toBeNull();
  });

  it('returns the default preset row when present', async () => {
    const chain = maybeSingle3EqChain({ data: { id: 'p1', is_default: true }, error: null });
    from.mockReturnValue(chain);
    const r = await getDefaultPresetForClient('agency-1', 'client-1');
    expect(r?.id).toBe('p1');
    expect(chain.eq1).toHaveBeenCalledWith('agency_organization_id', 'agency-1');
    expect(chain.eq2).toHaveBeenCalledWith('client_organization_id', 'client-1');
    expect(chain.eq3).toHaveBeenCalledWith('is_default', true);
  });

  it('returns null when no default exists', async () => {
    from.mockReturnValue(maybeSingle3EqChain({ data: null, error: null }));
    expect(await getDefaultPresetForClient('agency-1', 'client-1')).toBeNull();
  });

  it('returns null on DB error', async () => {
    from.mockReturnValue(maybeSingle3EqChain({ data: null, error: { message: 'rls' } }));
    expect(await getDefaultPresetForClient('agency-1', 'client-1')).toBeNull();
  });
});

// ─── getAgencyClientBillingPreset ───────────────────────────────────────────

describe('getAgencyClientBillingPreset', () => {
  it('returns null when presetId missing', async () => {
    expect(await getAgencyClientBillingPreset('')).toBeNull();
  });

  it('returns single preset on success', async () => {
    from.mockReturnValue(maybeSingle1EqChain({ data: { id: 'p1' }, error: null }));
    const r = await getAgencyClientBillingPreset('p1');
    expect(r?.id).toBe('p1');
  });

  it('returns null on DB error', async () => {
    from.mockReturnValue(maybeSingle1EqChain({ data: null, error: { message: 'fail' } }));
    expect(await getAgencyClientBillingPreset('p1')).toBeNull();
  });
});

// ─── createAgencyClientBillingPreset ────────────────────────────────────────

describe('createAgencyClientBillingPreset', () => {
  it('returns null when org context missing', async () => {
    expect(await createAgencyClientBillingPreset('', { client_organization_id: 'c1' })).toBeNull();
  });

  it('returns null when client_organization_id missing', async () => {
    expect(
      await createAgencyClientBillingPreset('agency-1', { client_organization_id: '' }),
    ).toBeNull();
  });

  it('returns null on count error', async () => {
    from.mockReturnValueOnce(countChain({ count: null, error: { message: 'rls' } }));
    expect(
      await createAgencyClientBillingPreset('agency-1', { client_organization_id: 'c1' }),
    ).toBeNull();
  });

  it('first preset for the pair: auto-default; clearDefaultExcept runs (no neq); insert sets is_default=true', async () => {
    let call = 0;
    const insertChain = insertReturningChain({ data: { id: 'new-p' }, error: null });
    const clearChain = clearDefaultNoNeqChain({ error: null });
    const countCh = countChain({ count: 0, error: null });
    from.mockImplementation(() => {
      call += 1;
      // 1: count, 2: clearDefaultExcept (no neq, since exceptId=null), 3: insert
      if (call === 1) return countCh;
      if (call === 2) return clearChain;
      return insertChain;
    });
    const id = await createAgencyClientBillingPreset('agency-1', {
      client_organization_id: 'c1',
    });
    expect(id).toBe('new-p');
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        agency_organization_id: 'agency-1',
        client_organization_id: 'c1',
        is_default: true,
        default_currency: 'EUR',
        default_tax_mode: 'manual',
        default_payment_terms_days: 30,
      }),
    );
  });

  it('second preset (count=1) without is_default flag: insert sets is_default=false; no clear', async () => {
    let call = 0;
    const insertChain = insertReturningChain({ data: { id: 'new-p' }, error: null });
    from.mockImplementation(() => {
      call += 1;
      // 1: count -> 1, 2: insert (no clearDefaultExcept since wantDefault=false)
      if (call === 1) return countChain({ count: 1, error: null });
      return insertChain;
    });
    const id = await createAgencyClientBillingPreset('agency-1', {
      client_organization_id: 'c1',
      label: 'EU branch',
    });
    expect(id).toBe('new-p');
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ is_default: false, label: 'EU branch' }),
    );
  });

  it('returns null on insert error', async () => {
    let call = 0;
    from.mockImplementation(() => {
      call += 1;
      if (call === 1) return countChain({ count: 1, error: null });
      return insertReturningChain({ data: null, error: { message: 'unique violation' } });
    });
    expect(
      await createAgencyClientBillingPreset('agency-1', { client_organization_id: 'c1' }),
    ).toBeNull();
  });
});

// ─── updateAgencyClientBillingPreset ────────────────────────────────────────

describe('updateAgencyClientBillingPreset', () => {
  it('returns false on missing ids', async () => {
    expect(await updateAgencyClientBillingPreset('', 'agency-1', { label: 'x' })).toBe(false);
    expect(await updateAgencyClientBillingPreset('p1', '', { label: 'x' })).toBe(false);
  });

  it('returns true on no-op patch (no fields changed)', async () => {
    expect(await updateAgencyClientBillingPreset('p1', 'agency-1', {})).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });

  it('updates fields and scopes by id + agency_organization_id', async () => {
    const chain = updateEqEqChain({ error: null });
    from.mockReturnValue(chain);
    expect(
      await updateAgencyClientBillingPreset('p1', 'agency-1', {
        label: 'updated',
        default_payment_terms_days: 14,
      }),
    ).toBe(true);
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'updated', default_payment_terms_days: 14 }),
    );
    expect(chain.first).toHaveBeenCalledWith('id', 'p1');
    expect(chain.second).toHaveBeenCalledWith('agency_organization_id', 'agency-1');
  });

  it('is_default=true: looks up clientOrgId, clears siblings (with neq), then updates', async () => {
    let call = 0;
    const lookupChain = maybeSingle1EqChain({
      data: { client_organization_id: 'c1' },
      error: null,
    });
    const clearChain = clearDefaultChain({ error: null });
    const updateChain = updateEqEqChain({ error: null });
    from.mockImplementation(() => {
      call += 1;
      if (call === 1) return lookupChain;
      if (call === 2) return clearChain;
      return updateChain;
    });
    expect(await updateAgencyClientBillingPreset('p1', 'agency-1', { is_default: true })).toBe(
      true,
    );
    expect(clearChain.eq1).toHaveBeenCalledWith('agency_organization_id', 'agency-1');
    expect(clearChain.eq2).toHaveBeenCalledWith('client_organization_id', 'c1');
    expect(clearChain.eq3).toHaveBeenCalledWith('is_default', true);
    expect(clearChain.neq).toHaveBeenCalledWith('id', 'p1');
    const updateArg = updateChain.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.is_default).toBe(true);
  });

  it('is_default=true but lookup fails: returns false (no update)', async () => {
    from.mockReturnValueOnce(maybeSingle1EqChain({ data: null, error: { message: 'rls' } }));
    expect(await updateAgencyClientBillingPreset('p1', 'agency-1', { is_default: true })).toBe(
      false,
    );
  });

  it('returns false on DB update error', async () => {
    from.mockReturnValue(updateEqEqChain({ error: { message: 'fail' } }));
    expect(await updateAgencyClientBillingPreset('p1', 'agency-1', { label: 'updated' })).toBe(
      false,
    );
  });
});

// ─── deleteAgencyClientBillingPreset ────────────────────────────────────────

describe('deleteAgencyClientBillingPreset', () => {
  it('returns false on missing ids', async () => {
    expect(await deleteAgencyClientBillingPreset('', 'agency-1')).toBe(false);
    expect(await deleteAgencyClientBillingPreset('p1', '')).toBe(false);
  });

  it('scopes delete by id + agency_organization_id', async () => {
    const chain = deleteEqEqChain({ error: null });
    from.mockReturnValue(chain);
    expect(await deleteAgencyClientBillingPreset('p1', 'agency-1')).toBe(true);
    expect(chain.first).toHaveBeenCalledWith('id', 'p1');
    expect(chain.second).toHaveBeenCalledWith('agency_organization_id', 'agency-1');
  });

  it('returns false on DB error', async () => {
    from.mockReturnValue(deleteEqEqChain({ error: { message: 'rls' } }));
    expect(await deleteAgencyClientBillingPreset('p1', 'agency-1')).toBe(false);
  });
});
