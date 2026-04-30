/**
 * Tests for `invoicesOverviewSupabase.ts` (unified invoice overview service).
 *
 * Coverage:
 *   - listInvoiceOverview filter normalization, clamping, pagination defaults
 *   - listInvoiceOverview RPC error handling (Option A: returns [])
 *   - listInvoiceOverview row normalization (raw RPC shape → typed row)
 *   - updateInvoiceTrackingStatus: validation (source_type/status), RPC call,
 *     error handling, ok=false handling
 *   - updateInvoiceTrackingNote: trim, length cap, null on empty, RPC call
 *
 * No real network. Single mock for `supabase.rpc`.
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';
import {
  listInvoiceOverview,
  updateInvoiceTrackingNote,
  updateInvoiceTrackingStatus,
} from '../invoicesOverviewSupabase';

const rpc = supabase.rpc as unknown as jest.Mock;

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

const ORG = '11111111-1111-1111-1111-111111111111';

describe('listInvoiceOverview', () => {
  it('returns [] without invoking RPC if organizationId is missing', async () => {
    const out = await listInvoiceOverview('');
    expect(out).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('forwards filters and clamps limit/offset to safe bounds', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await listInvoiceOverview(ORG, {
      year: 2026,
      month: 4,
      direction: 'agency_to_client',
      sourceType: 'manual',
      trackingStatus: 'paid',
      search: '  invoice 42  ',
      limit: 9999,
      offset: -10,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('list_invoice_overview', {
      p_organization_id: ORG,
      p_year: 2026,
      p_month: 4,
      p_direction: 'agency_to_client',
      p_source_type: 'manual',
      p_tracking_status: 'paid',
      p_search: '  invoice 42  ',
      p_limit: 500,
      p_offset: 0,
    });
  });

  it('passes nulls for unspecified filters and defaults limit to 100', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await listInvoiceOverview(ORG);
    expect(rpc).toHaveBeenCalledWith('list_invoice_overview', {
      p_organization_id: ORG,
      p_year: null,
      p_month: null,
      p_direction: null,
      p_source_type: null,
      p_tracking_status: null,
      p_search: null,
      p_limit: 100,
      p_offset: 0,
    });
  });

  it('returns [] when the RPC reports an error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const out = await listInvoiceOverview(ORG);
    expect(out).toEqual([]);
  });

  it('returns [] when the RPC throws (Option A: never throws)', async () => {
    rpc.mockRejectedValue(new Error('network'));
    const out = await listInvoiceOverview(ORG);
    expect(out).toEqual([]);
  });

  it('normalizes raw rows from both system and manual sources', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          source_type: 'system',
          source_id: 'sys-1',
          organization_id: ORG,
          invoice_number: 'INV-001',
          direction: 'agency_to_client',
          source_status: 'sent',
          tracking_status: null,
          internal_note: null,
          invoice_date: '2026-04-29',
          due_date: '2026-05-15',
          currency: 'EUR',
          total_amount_cents: 12345,
          sender_name: 'Agency Ltd',
          recipient_name: 'Client GmbH',
          client_name: 'Client GmbH',
          model_name: null,
          reference_label: null,
          has_payment_problem: false,
          source_created_at: '2026-04-29T10:00:00Z',
          metadata_updated_at: null,
          hosted_invoice_url: 'https://invoice.stripe.com/i/test',
          invoice_pdf_url: 'https://files.stripe.com/v1/foo',
        },
        {
          source_type: 'manual',
          source_id: 'man-1',
          organization_id: ORG,
          invoice_number: 'M-2026-001',
          direction: 'agency_to_model',
          source_status: 'generated',
          tracking_status: 'paid',
          internal_note: 'Paid by transfer',
          invoice_date: '2026-04-15',
          due_date: null,
          currency: 'USD',
          total_amount_cents: '999999',
          sender_name: 'Agency Ltd',
          recipient_name: 'Model Person',
          client_name: null,
          model_name: 'Model Person',
          reference_label: 'JOB-123',
          has_payment_problem: false,
          source_created_at: '2026-04-15T08:00:00Z',
          metadata_updated_at: '2026-04-20T09:00:00Z',
          hosted_invoice_url: null,
          invoice_pdf_url: null,
        },
      ],
      error: null,
    });
    const out = await listInvoiceOverview(ORG);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      sourceType: 'system',
      sourceId: 'sys-1',
      invoiceNumber: 'INV-001',
      direction: 'agency_to_client',
      trackingStatus: 'open',
      currency: 'EUR',
      totalAmountCents: 12345,
      hasPaymentProblem: false,
      hostedInvoiceUrl: 'https://invoice.stripe.com/i/test',
      invoicePdfUrl: 'https://files.stripe.com/v1/foo',
    });
    expect(out[1]).toMatchObject({
      sourceType: 'manual',
      sourceId: 'man-1',
      direction: 'agency_to_model',
      trackingStatus: 'paid',
      internalNote: 'Paid by transfer',
      totalAmountCents: 999999,
      currency: 'USD',
      modelName: 'Model Person',
      referenceLabel: 'JOB-123',
      hostedInvoiceUrl: null,
      invoicePdfUrl: null,
    });
  });

  it('strips unsafe invoice PDF URLs from RPC payloads', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          source_type: 'system',
          source_id: 'sys-u',
          organization_id: ORG,
          invoice_number: null,
          direction: 'agency_to_client',
          source_status: 'sent',
          tracking_status: 'open',
          internal_note: null,
          invoice_date: null,
          due_date: null,
          currency: 'EUR',
          total_amount_cents: 0,
          sender_name: null,
          recipient_name: null,
          client_name: null,
          model_name: null,
          reference_label: null,
          has_payment_problem: false,
          source_created_at: null,
          metadata_updated_at: null,
          hosted_invoice_url: 'https://evil.example/phish',
          invoice_pdf_url: 'javascript:alert(1)',
        },
      ],
      error: null,
    });
    const out = await listInvoiceOverview(ORG);
    expect(out[0].hostedInvoiceUrl).toBeNull();
    expect(out[0].invoicePdfUrl).toBeNull();
  });

  it('falls back tracking_status to "open" when an unknown value arrives', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          source_type: 'system',
          source_id: 'sys-x',
          organization_id: ORG,
          invoice_number: null,
          direction: 'agency_to_client',
          source_status: 'sent',
          tracking_status: 'mystery',
          internal_note: null,
          invoice_date: null,
          due_date: null,
          currency: null,
          total_amount_cents: null,
          sender_name: null,
          recipient_name: null,
          client_name: null,
          model_name: null,
          reference_label: null,
          has_payment_problem: null,
          source_created_at: null,
          metadata_updated_at: null,
        },
      ],
      error: null,
    });
    const out = await listInvoiceOverview(ORG);
    expect(out[0].trackingStatus).toBe('open');
    expect(out[0].currency).toBe('EUR');
    expect(out[0].totalAmountCents).toBe(0);
    expect(out[0].hasPaymentProblem).toBe(false);
  });
});

describe('updateInvoiceTrackingStatus', () => {
  it('refuses invalid source_type without invoking RPC', async () => {
    const ok = await updateInvoiceTrackingStatus(
      // @ts-expect-error — intentional invalid payload
      'wrong',
      'sys-1',
      'open',
    );
    expect(ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses invalid status without invoking RPC', async () => {
    const ok = await updateInvoiceTrackingStatus(
      'system',
      'sys-1',
      // @ts-expect-error — intentional invalid payload
      'closed',
    );
    expect(ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses missing source_id without invoking RPC', async () => {
    const ok = await updateInvoiceTrackingStatus('system', '', 'open');
    expect(ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns true on RPC ok and forwards args verbatim', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    const ok = await updateInvoiceTrackingStatus('manual', 'man-1', 'problem');
    expect(ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('update_invoice_tracking_status', {
      p_source_type: 'manual',
      p_source_id: 'man-1',
      p_status: 'problem',
    });
  });

  it('returns false on RPC error or non-ok payload', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });
    expect(await updateInvoiceTrackingStatus('system', 'sys-1', 'paid')).toBe(false);

    rpc.mockResolvedValueOnce({ data: { ok: false }, error: null });
    expect(await updateInvoiceTrackingStatus('system', 'sys-1', 'paid')).toBe(false);

    rpc.mockRejectedValueOnce(new Error('network'));
    expect(await updateInvoiceTrackingStatus('system', 'sys-1', 'paid')).toBe(false);
  });
});

describe('updateInvoiceTrackingNote', () => {
  it('refuses invalid source_type without invoking RPC', async () => {
    const ok = await updateInvoiceTrackingNote(
      // @ts-expect-error — intentional invalid payload
      'wrong',
      'sys-1',
      'note',
    );
    expect(ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses oversized notes (> 1000 chars) without invoking RPC', async () => {
    const big = 'x'.repeat(1001);
    const ok = await updateInvoiceTrackingNote('system', 'sys-1', big);
    expect(ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('forwards null when the note is empty/whitespace', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await updateInvoiceTrackingNote('system', 'sys-1', '   ');
    expect(rpc).toHaveBeenCalledWith('update_invoice_tracking_note', {
      p_source_type: 'system',
      p_source_id: 'sys-1',
      p_note: null,
    });
  });

  it('trims the note before sending', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await updateInvoiceTrackingNote('manual', 'man-1', '  hello  ');
    expect(rpc).toHaveBeenCalledWith('update_invoice_tracking_note', {
      p_source_type: 'manual',
      p_source_id: 'man-1',
      p_note: 'hello',
    });
  });

  it('returns false on RPC error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'denied' } });
    expect(await updateInvoiceTrackingNote('system', 'sys-1', 'x')).toBe(false);
  });

  it('returns false when ok is not true', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await updateInvoiceTrackingNote('system', 'sys-1', 'x')).toBe(false);
  });
});
