/**
 * Tests für invoicesSupabase.ts (B2B Stripe Invoicing).
 *
 * Coverage:
 *   - listInvoicesForOrganization / listInvoicesForRecipient (assertOrgContext + filters)
 *   - getInvoiceWithLines (joined fetch)
 *   - createInvoiceDraft / updateInvoiceDraft / deleteInvoiceDraft (Option A pattern)
 *   - addInvoiceLineItem / updateInvoiceLineItem / deleteInvoiceLineItem (auto recompute)
 *   - recomputeInvoiceTotals (manual + reverse_charge + stripe_tax branches)
 *   - sendInvoiceViaStripe (Edge Function dispatch)
 *
 * Invariants asserted:
 *   - Option A: never throws; returns false / null / [] on error.
 *   - assertOrgContext: empty orgId is caught early (returns [] / null without DB call).
 *   - Recompute respects tax_mode='stripe_tax' and reverse_charge_applied=true (no manual tax).
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    functions: { invoke: jest.fn() },
  },
}));

import { supabase } from '../../../lib/supabase';
import {
  listInvoicesForOrganization,
  listInvoicesForRecipient,
  getInvoiceWithLines,
  createInvoiceDraft,
  updateInvoiceDraft,
  deleteInvoiceDraft,
  addInvoiceLineItem,
  updateInvoiceLineItem,
  deleteInvoiceLineItem,
  recomputeInvoiceTotals,
  sendInvoiceViaStripe,
} from '../invoicesSupabase';

const from = supabase.from as jest.Mock;
const invoke = supabase.functions.invoke as unknown as jest.Mock;

let consoleErrorSpy: jest.SpyInstance;
let consoleWarnSpy: jest.SpyInstance;

beforeEach(() => {
  jest.resetAllMocks();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

// ─── Helpers: chainable mock builders ──────────────────────────────────────

/**
 * select().eq().order().limit().in()...
 * The service first builds q = select().eq().order().limit(), then optionally
 * chains q.in('status', ...) and q.in('invoice_type', ...). The limit() result
 * itself is awaitable AND has further chain methods. We mimic this by giving
 * limit() a thenable-with-methods, where each .in() returns the same shape.
 */
const listChain = (result: unknown) => {
  const inFn: jest.Mock = jest.fn();
  const buildResolvable = (): {
    in: jest.Mock;
    then: (cb: (v: unknown) => unknown) => Promise<unknown>;
  } => ({
    in: inFn,
    then: (cb: (v: unknown) => unknown) => Promise.resolve(cb(result)),
  });
  inFn.mockImplementation(() => buildResolvable());
  const limit = jest.fn().mockImplementation(() => buildResolvable());
  const order = jest.fn().mockReturnValue({ limit });
  const eq = jest.fn().mockReturnValue({ order });
  const select = jest.fn().mockReturnValue({ eq });
  return { select, eq, order, limit, in: inFn };
};

/** select().eq().maybeSingle() — terminal. */
const maybeSingleChain = (result: unknown) => {
  const maybeSingle = jest.fn().mockResolvedValue(result);
  const eq = jest.fn().mockReturnValue({ maybeSingle });
  const select = jest.fn().mockReturnValue({ eq });
  return { select, eq, maybeSingle };
};

/** insert().select().single() — terminal. */
const insertReturningChain = (result: unknown) => {
  const single = jest.fn().mockResolvedValue(result);
  const select = jest.fn().mockReturnValue({ single });
  const insert = jest.fn().mockReturnValue({ select });
  return { insert, select, single };
};

/** update().eq().eq() — terminal awaits the chain itself (returns thenable). */
const updateEqEqChain = (result: { error: unknown }) => {
  const second = jest.fn().mockResolvedValue(result);
  const first = jest.fn().mockReturnValue({ eq: second });
  const update = jest.fn().mockReturnValue({ eq: first });
  return { update, first, second };
};

/** delete().eq().eq() — terminal. */
const deleteEqEqChain = (result: { error: unknown }) => {
  const second = jest.fn().mockResolvedValue(result);
  const first = jest.fn().mockReturnValue({ eq: second });
  const del = jest.fn().mockReturnValue({ eq: first });
  return { delete: del, first, second };
};

// ─── listInvoicesForOrganization ───────────────────────────────────────────

describe('listInvoicesForOrganization', () => {
  it('returns [] when org context missing (assertOrgContext guard)', async () => {
    const r = await listInvoicesForOrganization('');
    expect(r).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('returns rows on success', async () => {
    const chain = listChain({ data: [{ id: 'inv-1' }, { id: 'inv-2' }], error: null });
    from.mockReturnValue(chain);
    const r = await listInvoicesForOrganization('org-1');
    expect(r).toHaveLength(2);
    expect(from).toHaveBeenCalledWith('invoices');
    expect(chain.eq).toHaveBeenCalledWith('organization_id', 'org-1');
  });

  it('returns [] on DB error', async () => {
    from.mockReturnValue(listChain({ data: null, error: { message: 'rls' } }));
    expect(await listInvoicesForOrganization('org-1')).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('applies status filter via .in()', async () => {
    const chain = listChain({ data: [], error: null });
    from.mockReturnValue(chain);
    await listInvoicesForOrganization('org-1', { statuses: ['draft', 'sent'] });
    expect(chain.in).toHaveBeenCalledWith('status', ['draft', 'sent']);
  });
});

// ─── listInvoicesForRecipient ──────────────────────────────────────────────

describe('listInvoicesForRecipient', () => {
  it('returns [] when org context missing', async () => {
    expect(await listInvoicesForRecipient('')).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('queries by recipient_organization_id', async () => {
    const chain = listChain({ data: [{ id: 'inv-1' }], error: null });
    from.mockReturnValue(chain);
    const r = await listInvoicesForRecipient('org-2');
    expect(r).toHaveLength(1);
    expect(chain.eq).toHaveBeenCalledWith('recipient_organization_id', 'org-2');
  });

  // Anti-regression: the Received tab in InvoicesPanel passes the full
  // recipient-visible status set so void/uncollectible invoices remain visible
  // to the recipient owner (matches RLS invoices_recipient_owner_select).
  it('forwards full recipient-visible status set incl. void/uncollectible', async () => {
    const chain = listChain({ data: [], error: null });
    from.mockReturnValue(chain);
    await listInvoicesForRecipient('org-2', {
      statuses: ['sent', 'paid', 'overdue', 'void', 'uncollectible'],
    });
    expect(chain.in).toHaveBeenCalledWith('status', [
      'sent',
      'paid',
      'overdue',
      'void',
      'uncollectible',
    ]);
  });
});

// ─── getInvoiceWithLines ───────────────────────────────────────────────────

describe('getInvoiceWithLines', () => {
  it('returns null when invoiceId is empty', async () => {
    expect(await getInvoiceWithLines('')).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('returns null when invoice not found', async () => {
    from.mockImplementation((t: string) => {
      if (t === 'invoices') return maybeSingleChain({ data: null, error: null });
      return maybeSingleChain({ data: null, error: null });
    });
    expect(await getInvoiceWithLines('inv-1')).toBeNull();
  });

  it('returns invoice + line items on success', async () => {
    const invoiceRow = { id: 'inv-1', status: 'draft', currency: 'EUR' };
    const lineRows = [{ id: 'l-1' }, { id: 'l-2' }];
    from.mockImplementation((t: string) => {
      if (t === 'invoices') return maybeSingleChain({ data: invoiceRow, error: null });
      // lines query: select().eq().order() — terminal awaits order
      const order = jest.fn().mockResolvedValue({ data: lineRows, error: null });
      const eq = jest.fn().mockReturnValue({ order });
      const select = jest.fn().mockReturnValue({ eq });
      return { select, eq, order };
    });
    const result = await getInvoiceWithLines('inv-1');
    expect(result?.id).toBe('inv-1');
    expect(result?.line_items).toHaveLength(2);
  });
});

// ─── createInvoiceDraft ────────────────────────────────────────────────────

describe('createInvoiceDraft', () => {
  it('returns null when org context missing', async () => {
    expect(await createInvoiceDraft('', { invoice_type: 'agency_to_client' })).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('returns new id on success and defaults tax_mode=manual + currency=EUR', async () => {
    const chain = insertReturningChain({ data: { id: 'new-inv' }, error: null });
    from.mockReturnValue(chain);
    const id = await createInvoiceDraft('org-1', {
      invoice_type: 'agency_to_client',
      recipient_organization_id: 'org-2',
    });
    expect(id).toBe('new-inv');
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'org-1',
        invoice_type: 'agency_to_client',
        status: 'draft',
        currency: 'EUR',
        tax_mode: 'manual',
        reverse_charge_applied: false,
      }),
    );
  });

  it('returns null on DB error', async () => {
    from.mockReturnValue(
      insertReturningChain({ data: null, error: { message: 'unique_violation' } }),
    );
    expect(await createInvoiceDraft('org-1', { invoice_type: 'platform_to_agency' })).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

// ─── updateInvoiceDraft ────────────────────────────────────────────────────

describe('updateInvoiceDraft', () => {
  it('returns false when invoiceId missing', async () => {
    expect(await updateInvoiceDraft('', { notes: 'x' })).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('returns true on no-op patch (no fields changed)', async () => {
    expect(await updateInvoiceDraft('inv-1', {})).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });

  it('updates only on draft rows (status=draft guard)', async () => {
    const chain = updateEqEqChain({ error: null });
    from.mockReturnValue(chain);
    expect(
      await updateInvoiceDraft('inv-1', {
        notes: 'updated',
        tax_rate_percent: 19,
        reverse_charge_applied: true,
      }),
    ).toBe(true);
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: 'updated',
        tax_rate_percent: 19,
        reverse_charge_applied: true,
      }),
    );
    expect(chain.first).toHaveBeenCalledWith('id', 'inv-1');
    expect(chain.second).toHaveBeenCalledWith('status', 'draft');
  });

  it('returns false on DB error', async () => {
    from.mockReturnValue(updateEqEqChain({ error: { message: 'fail' } }));
    expect(await updateInvoiceDraft('inv-1', { notes: 'x' })).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

// ─── deleteInvoiceDraft ────────────────────────────────────────────────────

describe('deleteInvoiceDraft', () => {
  it('returns false when invoiceId missing', async () => {
    expect(await deleteInvoiceDraft('')).toBe(false);
  });

  it('returns true on success and only deletes draft rows', async () => {
    const chain = deleteEqEqChain({ error: null });
    from.mockReturnValue(chain);
    expect(await deleteInvoiceDraft('inv-1')).toBe(true);
    expect(chain.first).toHaveBeenCalledWith('id', 'inv-1');
    expect(chain.second).toHaveBeenCalledWith('status', 'draft');
  });

  it('returns false on DB error', async () => {
    from.mockReturnValue(deleteEqEqChain({ error: { message: 'rls' } }));
    expect(await deleteInvoiceDraft('inv-1')).toBe(false);
  });
});

// ─── recomputeInvoiceTotals (tax modes) ────────────────────────────────────

/**
 * recomputeInvoiceTotals chains:
 *   from('invoices').select().eq().maybeSingle()  → invoice meta
 *   from('invoice_line_items').select().eq()      → line totals
 *   from('invoices').update().eq().eq()           → write totals (status=draft only)
 */
function setupRecomputeMocks(opts: {
  invoice: {
    id: string;
    status: string;
    tax_rate_percent: number | null;
    tax_mode: 'manual' | 'stripe_tax';
    reverse_charge_applied: boolean;
  };
  lineTotals: number[];
  updateError?: unknown;
}) {
  const updateChain = updateEqEqChain({ error: opts.updateError ?? null });
  let invoicesCall = 0;
  from.mockImplementation((t: string) => {
    if (t === 'invoices') {
      invoicesCall += 1;
      if (invoicesCall === 1) {
        return maybeSingleChain({ data: opts.invoice, error: null });
      }
      return updateChain;
    }
    // invoice_line_items
    const eq = jest.fn().mockResolvedValue({
      data: opts.lineTotals.map((t) => ({ total_amount_cents: t })),
      error: null,
    });
    const select = jest.fn().mockReturnValue({ eq });
    return { select, eq };
  });
  return { updateChain };
}

describe('recomputeInvoiceTotals', () => {
  it('returns false on empty invoiceId', async () => {
    expect(await recomputeInvoiceTotals('')).toBe(false);
  });

  it('manual tax mode: applies tax_rate_percent to subtotal', async () => {
    const m = setupRecomputeMocks({
      invoice: {
        id: 'inv-1',
        status: 'draft',
        tax_rate_percent: 19,
        tax_mode: 'manual',
        reverse_charge_applied: false,
      },
      lineTotals: [10000, 5000], // subtotal 15000
    });
    const ok = await recomputeInvoiceTotals('inv-1');
    expect(ok).toBe(true);
    expect(m.updateChain.update).toHaveBeenCalledWith({
      subtotal_amount_cents: 15000,
      tax_amount_cents: 2850, // 15000 * 19 / 100
      total_amount_cents: 17850,
    });
  });

  it('reverse_charge_applied=true: tax = 0 even with rate set', async () => {
    const m = setupRecomputeMocks({
      invoice: {
        id: 'inv-1',
        status: 'draft',
        tax_rate_percent: 19,
        tax_mode: 'manual',
        reverse_charge_applied: true,
      },
      lineTotals: [10000],
    });
    await recomputeInvoiceTotals('inv-1');
    expect(m.updateChain.update).toHaveBeenCalledWith({
      subtotal_amount_cents: 10000,
      tax_amount_cents: 0,
      total_amount_cents: 10000,
    });
  });

  it('tax_mode=stripe_tax: tax = 0 locally (Stripe Tax computes downstream)', async () => {
    const m = setupRecomputeMocks({
      invoice: {
        id: 'inv-1',
        status: 'draft',
        tax_rate_percent: 19,
        tax_mode: 'stripe_tax',
        reverse_charge_applied: false,
      },
      lineTotals: [10000],
    });
    await recomputeInvoiceTotals('inv-1');
    expect(m.updateChain.update).toHaveBeenCalledWith({
      subtotal_amount_cents: 10000,
      tax_amount_cents: 0,
      total_amount_cents: 10000,
    });
  });

  it('non-draft invoice: skips recompute and returns true', async () => {
    from.mockImplementation((t: string) => {
      if (t === 'invoices') {
        return maybeSingleChain({
          data: {
            id: 'inv-1',
            status: 'sent',
            tax_rate_percent: 19,
            tax_mode: 'manual',
            reverse_charge_applied: false,
          },
          error: null,
        });
      }
      return maybeSingleChain({ data: null, error: null });
    });
    expect(await recomputeInvoiceTotals('inv-1')).toBe(true);
  });
});

// ─── addInvoiceLineItem ────────────────────────────────────────────────────

describe('addInvoiceLineItem', () => {
  it('returns null when invoiceId missing', async () => {
    expect(
      await addInvoiceLineItem('', {
        description: 'x',
        quantity: 1,
        unit_amount_cents: 100,
      }),
    ).toBeNull();
  });

  it('inserts and triggers recompute on success', async () => {
    const insertChain = insertReturningChain({ data: { id: 'line-1' }, error: null });
    // After insert, recompute reads invoice + lines + updates totals
    let invoicesCall = 0;
    from.mockImplementation((t: string) => {
      if (t === 'invoice_line_items') {
        // First call: insert.  Subsequent: recompute's line read (select().eq()).
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
      // invoices: recompute meta read, then update
      invoicesCall += 1;
      if (invoicesCall === 1) {
        return maybeSingleChain({
          data: {
            id: 'inv-1',
            status: 'draft',
            tax_rate_percent: 0,
            tax_mode: 'manual',
            reverse_charge_applied: false,
          },
          error: null,
        });
      }
      return updateEqEqChain({ error: null });
    });
    const id = await addInvoiceLineItem('inv-1', {
      description: 'Service',
      quantity: 2,
      unit_amount_cents: 100,
    });
    expect(id).toBe('line-1');
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice_id: 'inv-1',
        description: 'Service',
        quantity: 2,
        unit_amount_cents: 100,
        total_amount_cents: 200,
      }),
    );
  });

  it('returns null on DB error', async () => {
    from.mockReturnValue(insertReturningChain({ data: null, error: { message: 'rls' } }));
    const id = await addInvoiceLineItem('inv-1', {
      description: 'x',
      quantity: 1,
      unit_amount_cents: 100,
    });
    expect(id).toBeNull();
  });
});

// ─── deleteInvoiceLineItem ─────────────────────────────────────────────────

describe('deleteInvoiceLineItem', () => {
  it('returns false on missing ids', async () => {
    expect(await deleteInvoiceLineItem('', 'inv')).toBe(false);
    expect(await deleteInvoiceLineItem('line', '')).toBe(false);
  });

  it('returns false on DB error', async () => {
    from.mockReturnValue(deleteEqEqChain({ error: { message: 'fail' } }));
    expect(await deleteInvoiceLineItem('line-1', 'inv-1')).toBe(false);
  });
});

// ─── updateInvoiceLineItem ─────────────────────────────────────────────────

describe('updateInvoiceLineItem', () => {
  it('returns false on missing ids', async () => {
    expect(await updateInvoiceLineItem('', 'inv', {})).toBe(false);
    expect(await updateInvoiceLineItem('line', '', {})).toBe(false);
  });
});

// ─── sendInvoiceViaStripe ──────────────────────────────────────────────────

describe('sendInvoiceViaStripe', () => {
  it('returns ok=false on empty id without invoking', async () => {
    const r = await sendInvoiceViaStripe('');
    expect(r.ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('returns ok=true and forwards hosted_url/pdf_url on success', async () => {
    invoke.mockResolvedValue({
      data: {
        ok: true,
        hosted_url: 'https://stripe.invoice/u',
        pdf_url: 'https://stripe.invoice/p',
      },
      error: null,
    });
    const r = await sendInvoiceViaStripe('inv-1');
    expect(r.ok).toBe(true);
    expect(r.hosted_url).toBe('https://stripe.invoice/u');
    expect(r.pdf_url).toBe('https://stripe.invoice/p');
    expect(invoke).toHaveBeenCalledWith('send-invoice-via-stripe', {
      body: { invoice_id: 'inv-1' },
    });
  });

  it('returns ok=false when Edge Function reports invoke error', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const r = await sendInvoiceViaStripe('inv-1');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('boom');
  });

  it('returns ok=false when payload.ok=false', async () => {
    invoke.mockResolvedValue({
      data: { ok: false, error: 'not_owner' },
      error: null,
    });
    const r = await sendInvoiceViaStripe('inv-1');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('not_owner');
  });

  it('catches exceptions (Option C contract: never throws)', async () => {
    invoke.mockRejectedValue(new Error('network'));
    const r = await sendInvoiceViaStripe('inv-1');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('network');
  });
});
