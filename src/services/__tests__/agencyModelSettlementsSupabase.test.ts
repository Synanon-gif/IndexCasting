/**
 * Tests for agencyModelSettlementsSupabase.ts (Agency ↔ Model internal settlements).
 *
 * Coverage:
 *   - listAgencyModelSettlements (assertOrgContext + filters)
 *   - getAgencyModelSettlementWithItems (joined fetch)
 *   - createAgencyModelSettlement (Option A pattern)
 *   - updateAgencyModelSettlement / markAgencyModelSettlementPaid
 *   - deleteAgencyModelSettlement (draft-only via status guard)
 *   - addAgencyModelSettlementItem / deleteAgencyModelSettlementItem (auto recompute)
 *   - recomputeSettlementTotals (gross/net math; non-draft skip)
 *
 * Invariants asserted:
 *   - Option A: never throws; returns false / null / [] on error.
 *   - assertOrgContext: empty orgId is caught early (returns [] / null / false without DB call).
 *   - Recompute respects commission_amount_cents and skips when status !== 'draft'.
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';
import {
  listAgencyModelSettlements,
  getAgencyModelSettlementWithItems,
  createAgencyModelSettlement,
  updateAgencyModelSettlement,
  markAgencyModelSettlementPaid,
  deleteAgencyModelSettlement,
  addAgencyModelSettlementItem,
  deleteAgencyModelSettlementItem,
  recomputeSettlementTotals,
} from '../agencyModelSettlementsSupabase';

const from = supabase.from as jest.Mock;

let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.resetAllMocks();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

// ─── Helpers: chainable mock builders ──────────────────────────────────────

/**
 * select().eq().order().limit() — the limit() result is awaitable AND has
 * further chain methods .in(). We mimic this by giving limit() a thenable
 * with .in/.eq methods that each return the same shape.
 */
const listChain = (result: unknown) => {
  const inFn: jest.Mock = jest.fn();
  const eqAfter: jest.Mock = jest.fn();
  const buildResolvable = (): {
    in: jest.Mock;
    eq: jest.Mock;
    then: (cb: (v: unknown) => unknown) => Promise<unknown>;
  } => ({
    in: inFn,
    eq: eqAfter,
    then: (cb: (v: unknown) => unknown) => Promise.resolve(cb(result)),
  });
  inFn.mockImplementation(() => buildResolvable());
  eqAfter.mockImplementation(() => buildResolvable());
  const limit = jest.fn().mockImplementation(() => buildResolvable());
  const order = jest.fn().mockReturnValue({ limit });
  const eq = jest.fn().mockReturnValue({ order });
  const select = jest.fn().mockReturnValue({ eq });
  return { select, eq, order, limit, in: inFn, eqAfter };
};

const maybeSingleChain = (result: unknown) => {
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

const deleteEqEqEqChain = (result: { error: unknown }) => {
  const third = jest.fn().mockResolvedValue(result);
  const second = jest.fn().mockReturnValue({ eq: third });
  const first = jest.fn().mockReturnValue({ eq: second });
  const del = jest.fn().mockReturnValue({ eq: first });
  return { delete: del, first, second, third };
};

const deleteEqEqChain = (result: { error: unknown }) => {
  const second = jest.fn().mockResolvedValue(result);
  const first = jest.fn().mockReturnValue({ eq: second });
  const del = jest.fn().mockReturnValue({ eq: first });
  return { delete: del, first, second };
};

// ─── listAgencyModelSettlements ─────────────────────────────────────────────

describe('listAgencyModelSettlements', () => {
  it('returns [] when org context missing (assertOrgContext guard)', async () => {
    expect(await listAgencyModelSettlements('')).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('returns rows on success and queries by organization_id', async () => {
    const chain = listChain({ data: [{ id: 's1' }, { id: 's2' }], error: null });
    from.mockReturnValue(chain);
    const r = await listAgencyModelSettlements('org-1');
    expect(r).toHaveLength(2);
    expect(from).toHaveBeenCalledWith('agency_model_settlements');
    expect(chain.eq).toHaveBeenCalledWith('organization_id', 'org-1');
  });

  it('returns [] on DB error', async () => {
    from.mockReturnValue(listChain({ data: null, error: { message: 'rls' } }));
    expect(await listAgencyModelSettlements('org-1')).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('applies status filter via .in()', async () => {
    const chain = listChain({ data: [], error: null });
    from.mockReturnValue(chain);
    await listAgencyModelSettlements('org-1', { statuses: ['draft', 'recorded'] });
    expect(chain.in).toHaveBeenCalledWith('status', ['draft', 'recorded']);
  });
});

// ─── getAgencyModelSettlementWithItems ──────────────────────────────────────

describe('getAgencyModelSettlementWithItems', () => {
  it('returns null when settlementId missing', async () => {
    expect(await getAgencyModelSettlementWithItems('')).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('returns null when settlement not found', async () => {
    from.mockImplementation(() => maybeSingleChain({ data: null, error: null }));
    expect(await getAgencyModelSettlementWithItems('s-1')).toBeNull();
  });

  it('returns settlement + items on success', async () => {
    const settlement = { id: 's-1', status: 'draft', currency: 'EUR' };
    const items = [{ id: 'i-1' }, { id: 'i-2' }];
    from.mockImplementation((t: string) => {
      if (t === 'agency_model_settlements') {
        return maybeSingleChain({ data: settlement, error: null });
      }
      const order = jest.fn().mockResolvedValue({ data: items, error: null });
      const eq = jest.fn().mockReturnValue({ order });
      const select = jest.fn().mockReturnValue({ eq });
      return { select, eq, order };
    });
    const result = await getAgencyModelSettlementWithItems('s-1');
    expect(result?.id).toBe('s-1');
    expect(result?.items).toHaveLength(2);
  });
});

// ─── createAgencyModelSettlement ────────────────────────────────────────────

describe('createAgencyModelSettlement', () => {
  it('returns null when org context missing', async () => {
    expect(await createAgencyModelSettlement('', { model_id: 'm-1' })).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('returns null when model_id missing', async () => {
    expect(await createAgencyModelSettlement('org-1', { model_id: '' })).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('returns new id on success and defaults status=draft + currency=EUR', async () => {
    const chain = insertReturningChain({ data: { id: 'new-s' }, error: null });
    from.mockReturnValue(chain);
    const id = await createAgencyModelSettlement('org-1', { model_id: 'm-1' });
    expect(id).toBe('new-s');
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'org-1',
        model_id: 'm-1',
        status: 'draft',
        currency: 'EUR',
        gross_amount_cents: 0,
        commission_amount_cents: 0,
        net_amount_cents: 0,
      }),
    );
  });

  it('returns null on DB error', async () => {
    from.mockReturnValue(insertReturningChain({ data: null, error: { message: 'rls' } }));
    expect(await createAgencyModelSettlement('org-1', { model_id: 'm-1' })).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

// ─── updateAgencyModelSettlement ────────────────────────────────────────────

describe('updateAgencyModelSettlement', () => {
  it('returns false when settlementId missing', async () => {
    expect(await updateAgencyModelSettlement('', 'org-1', { notes: 'x' })).toBe(false);
  });

  it('returns false when org context missing', async () => {
    expect(await updateAgencyModelSettlement('s-1', '', { notes: 'x' })).toBe(false);
  });

  it('returns true on no-op patch (no fields changed)', async () => {
    expect(await updateAgencyModelSettlement('s-1', 'org-1', {})).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });

  it('updates fields and scopes by id + organization_id', async () => {
    const chain = updateEqEqChain({ error: null });
    from.mockReturnValue(chain);
    expect(
      await updateAgencyModelSettlement('s-1', 'org-1', {
        notes: 'updated',
        commission_amount_cents: 1500,
      }),
    ).toBe(true);
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ notes: 'updated', commission_amount_cents: 1500 }),
    );
    expect(chain.first).toHaveBeenCalledWith('id', 's-1');
    expect(chain.second).toHaveBeenCalledWith('organization_id', 'org-1');
  });

  it('sets paid_at when status=paid', async () => {
    const chain = updateEqEqChain({ error: null });
    from.mockReturnValue(chain);
    await updateAgencyModelSettlement('s-1', 'org-1', { status: 'paid' });
    const updateArg = chain.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.status).toBe('paid');
    expect(typeof updateArg.paid_at).toBe('string');
  });

  it('returns false on DB error', async () => {
    from.mockReturnValue(updateEqEqChain({ error: { message: 'fail' } }));
    expect(await updateAgencyModelSettlement('s-1', 'org-1', { notes: 'x' })).toBe(false);
  });
});

// ─── markAgencyModelSettlementPaid ──────────────────────────────────────────

describe('markAgencyModelSettlementPaid', () => {
  it('delegates to updateAgencyModelSettlement with status=paid', async () => {
    const chain = updateEqEqChain({ error: null });
    from.mockReturnValue(chain);
    expect(await markAgencyModelSettlementPaid('s-1', 'org-1')).toBe(true);
    const updateArg = chain.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.status).toBe('paid');
  });
});

// ─── deleteAgencyModelSettlement ────────────────────────────────────────────

describe('deleteAgencyModelSettlement', () => {
  it('returns false on missing ids', async () => {
    expect(await deleteAgencyModelSettlement('', 'org-1')).toBe(false);
    expect(await deleteAgencyModelSettlement('s-1', '')).toBe(false);
  });

  it('scopes delete by id + organization_id + status=draft', async () => {
    const chain = deleteEqEqEqChain({ error: null });
    from.mockReturnValue(chain);
    expect(await deleteAgencyModelSettlement('s-1', 'org-1')).toBe(true);
    expect(chain.first).toHaveBeenCalledWith('id', 's-1');
    expect(chain.second).toHaveBeenCalledWith('organization_id', 'org-1');
    expect(chain.third).toHaveBeenCalledWith('status', 'draft');
  });

  it('returns false on DB error', async () => {
    from.mockReturnValue(deleteEqEqEqChain({ error: { message: 'rls' } }));
    expect(await deleteAgencyModelSettlement('s-1', 'org-1')).toBe(false);
  });
});

// ─── recomputeSettlementTotals ──────────────────────────────────────────────

function setupRecomputeMocks(opts: {
  settlement: { id: string; status: string; commission_amount_cents: number };
  itemTotals: number[];
  updateError?: unknown;
}) {
  const updateChain = updateEqEqChain({ error: opts.updateError ?? null });
  let settlementsCall = 0;
  from.mockImplementation((t: string) => {
    if (t === 'agency_model_settlements') {
      settlementsCall += 1;
      if (settlementsCall === 1) {
        return maybeSingleChain({ data: opts.settlement, error: null });
      }
      return updateChain;
    }
    const eq = jest.fn().mockResolvedValue({
      data: opts.itemTotals.map((t) => ({ total_amount_cents: t })),
      error: null,
    });
    const select = jest.fn().mockReturnValue({ eq });
    return { select, eq };
  });
  return { updateChain };
}

describe('recomputeSettlementTotals', () => {
  it('returns false on empty settlementId', async () => {
    expect(await recomputeSettlementTotals('')).toBe(false);
  });

  it('computes gross = sum(items); net = gross - commission', async () => {
    const m = setupRecomputeMocks({
      settlement: { id: 's-1', status: 'draft', commission_amount_cents: 2000 },
      itemTotals: [10000, 5000],
    });
    expect(await recomputeSettlementTotals('s-1')).toBe(true);
    expect(m.updateChain.update).toHaveBeenCalledWith({
      gross_amount_cents: 15000,
      net_amount_cents: 13000,
    });
  });

  it('non-draft settlement: skips recompute and returns true', async () => {
    from.mockImplementation((t: string) => {
      if (t === 'agency_model_settlements') {
        return maybeSingleChain({
          data: { id: 's-1', status: 'recorded', commission_amount_cents: 0 },
          error: null,
        });
      }
      return maybeSingleChain({ data: null, error: null });
    });
    expect(await recomputeSettlementTotals('s-1')).toBe(true);
  });

  it('settlement not found: returns true (no-op)', async () => {
    from.mockImplementation(() => maybeSingleChain({ data: null, error: null }));
    expect(await recomputeSettlementTotals('s-1')).toBe(true);
  });
});

// ─── addAgencyModelSettlementItem ───────────────────────────────────────────

describe('addAgencyModelSettlementItem', () => {
  it('returns null when settlementId missing', async () => {
    expect(
      await addAgencyModelSettlementItem('', {
        description: 'x',
        quantity: 1,
        unit_amount_cents: 100,
      }),
    ).toBeNull();
  });

  it('inserts and triggers recompute on success', async () => {
    const insertChain = insertReturningChain({ data: { id: 'item-1' }, error: null });
    let settlementsCall = 0;
    from.mockImplementation((t: string) => {
      if (t === 'agency_model_settlement_items') {
        if ((insertChain.insert as jest.Mock).mock.calls.length === 0) {
          return insertChain;
        }
        const eq = jest.fn().mockResolvedValue({
          data: [{ total_amount_cents: 200 }],
          error: null,
        });
        const select = jest.fn().mockReturnValue({ eq });
        return { select, eq };
      }
      // agency_model_settlements: recompute meta read, then update
      settlementsCall += 1;
      if (settlementsCall === 1) {
        return maybeSingleChain({
          data: { id: 's-1', status: 'draft', commission_amount_cents: 0 },
          error: null,
        });
      }
      return updateEqEqChain({ error: null });
    });
    const id = await addAgencyModelSettlementItem('s-1', {
      description: 'Job payout',
      quantity: 2,
      unit_amount_cents: 100,
    });
    expect(id).toBe('item-1');
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        settlement_id: 's-1',
        description: 'Job payout',
        quantity: 2,
        unit_amount_cents: 100,
        total_amount_cents: 200,
      }),
    );
  });

  it('returns null on DB error', async () => {
    from.mockReturnValue(insertReturningChain({ data: null, error: { message: 'rls' } }));
    expect(
      await addAgencyModelSettlementItem('s-1', {
        description: 'x',
        quantity: 1,
        unit_amount_cents: 100,
      }),
    ).toBeNull();
  });
});

// ─── deleteAgencyModelSettlementItem ────────────────────────────────────────

describe('deleteAgencyModelSettlementItem', () => {
  it('returns false on missing ids', async () => {
    expect(await deleteAgencyModelSettlementItem('', 's-1')).toBe(false);
    expect(await deleteAgencyModelSettlementItem('i-1', '')).toBe(false);
  });

  it('returns false on DB error', async () => {
    from.mockReturnValue(deleteEqEqChain({ error: { message: 'fail' } }));
    expect(await deleteAgencyModelSettlementItem('i-1', 's-1')).toBe(false);
  });
});
