import {
  billingCategoryRoles,
  billingTabBadgeForRole,
  deriveBillingAttention,
  filterBillingAttentionForRole,
  highestBillingSeverityForRole,
  type BillingAttentionInput,
} from '../billingAttention';
import type { AgencyModelSettlementRow, InvoiceRow } from '../../types/billingTypes';

const FIXED_TODAY = '2026-04-19';
const ORG_A = 'org-a';
const ORG_B = 'org-b';

function makeInvoice(over: Partial<InvoiceRow>): InvoiceRow {
  return {
    id: over.id ?? 'inv-1',
    organization_id: over.organization_id ?? ORG_A,
    recipient_organization_id: over.recipient_organization_id ?? ORG_B,
    invoice_type: over.invoice_type ?? 'agency_to_client',
    status: over.status ?? 'draft',
    invoice_number: over.invoice_number ?? 'INV-001',
    source_option_request_id: over.source_option_request_id ?? null,
    period_start: over.period_start ?? null,
    period_end: over.period_end ?? null,
    payment_provider: over.payment_provider ?? 'stripe',
    payment_provider_metadata: over.payment_provider_metadata ?? {},
    stripe_invoice_id: over.stripe_invoice_id ?? null,
    stripe_hosted_url: over.stripe_hosted_url ?? null,
    stripe_pdf_url: over.stripe_pdf_url ?? null,
    stripe_payment_intent_id: over.stripe_payment_intent_id ?? null,
    billing_profile_snapshot: over.billing_profile_snapshot ?? null,
    recipient_billing_snapshot: over.recipient_billing_snapshot ?? null,
    currency: over.currency ?? 'EUR',
    subtotal_amount_cents: over.subtotal_amount_cents ?? 10000,
    tax_amount_cents: over.tax_amount_cents ?? 0,
    total_amount_cents: over.total_amount_cents ?? 10000,
    tax_rate_percent: over.tax_rate_percent ?? null,
    tax_mode: over.tax_mode ?? 'manual',
    reverse_charge_applied: over.reverse_charge_applied ?? false,
    notes: over.notes ?? null,
    due_date: over.due_date ?? null,
    sent_at: over.sent_at ?? null,
    paid_at: over.paid_at ?? null,
    last_stripe_failure_at: over.last_stripe_failure_at ?? null,
    last_stripe_failure_reason: over.last_stripe_failure_reason ?? null,
    created_by: over.created_by ?? null,
    sent_by: over.sent_by ?? null,
    created_at: over.created_at ?? '2026-04-01T00:00:00.000Z',
    updated_at: over.updated_at ?? '2026-04-01T00:00:00.000Z',
  };
}

function makeSettlement(over: Partial<AgencyModelSettlementRow>): AgencyModelSettlementRow {
  return {
    id: over.id ?? 'st-1',
    organization_id: over.organization_id ?? ORG_A,
    model_id: over.model_id ?? 'model-1',
    source_option_request_id: over.source_option_request_id ?? null,
    settlement_number: over.settlement_number ?? 'ST-001',
    status: over.status ?? 'draft',
    currency: over.currency ?? 'EUR',
    gross_amount_cents: over.gross_amount_cents ?? 0,
    commission_amount_cents: over.commission_amount_cents ?? 0,
    net_amount_cents: over.net_amount_cents ?? 5000,
    notes: over.notes ?? null,
    metadata: over.metadata ?? {},
    recorded_at: over.recorded_at ?? null,
    paid_at: over.paid_at ?? null,
    created_by: over.created_by ?? null,
    created_at: over.created_at ?? '2026-04-01T00:00:00.000Z',
    updated_at: over.updated_at ?? '2026-04-01T00:00:00.000Z',
  };
}

function input(over: BillingAttentionInput = {}): BillingAttentionInput {
  return { today: FIXED_TODAY, ...over };
}

describe('deriveBillingAttention — issued invoices', () => {
  test('empty input returns empty array', () => {
    expect(deriveBillingAttention(input())).toEqual([]);
  });

  test('paid / void / uncollectible never trigger', () => {
    const sigs = deriveBillingAttention(
      input({
        issuedInvoices: [
          makeInvoice({ id: 'a', status: 'paid' }),
          makeInvoice({ id: 'b', status: 'void' }),
          makeInvoice({ id: 'c', status: 'uncollectible' }),
        ],
      }),
    );
    expect(sigs).toEqual([]);
  });

  test('sent + due_date in past → invoice_overdue (critical)', () => {
    const sigs = deriveBillingAttention(
      input({
        issuedInvoices: [makeInvoice({ id: 'a', status: 'sent', due_date: '2026-04-01' })],
      }),
    );
    expect(sigs).toHaveLength(1);
    expect(sigs[0].category).toBe('invoice_overdue');
    expect(sigs[0].severity).toBe('critical');
    expect(sigs[0].sourceId).toBe('a');
  });

  test('sent + due_date in future → invoice_unpaid (high)', () => {
    const sigs = deriveBillingAttention(
      input({
        issuedInvoices: [makeInvoice({ id: 'a', status: 'sent', due_date: '2026-05-01' })],
      }),
    );
    expect(sigs[0].category).toBe('invoice_unpaid');
    expect(sigs[0].severity).toBe('high');
  });

  test('sent without due_date → invoice_unpaid (no overdue without date)', () => {
    const sigs = deriveBillingAttention(
      input({
        issuedInvoices: [makeInvoice({ id: 'a', status: 'sent', due_date: null })],
      }),
    );
    expect(sigs[0].category).toBe('invoice_unpaid');
  });

  test('explicit overdue status always critical', () => {
    const sigs = deriveBillingAttention(
      input({
        issuedInvoices: [makeInvoice({ id: 'a', status: 'overdue' })],
      }),
    );
    expect(sigs[0].category).toBe('invoice_overdue');
  });

  test('pending_send recent (< stuck threshold) → no signal', () => {
    const sigs = deriveBillingAttention(
      input({
        pendingSendStuckMinutes: 30,
        issuedInvoices: [
          makeInvoice({
            id: 'a',
            status: 'pending_send',
            updated_at: new Date().toISOString(),
          }),
        ],
      }),
    );
    expect(sigs).toEqual([]);
  });

  test('pending_send stuck → invoice_pending_send (critical)', () => {
    const sigs = deriveBillingAttention(
      input({
        pendingSendStuckMinutes: 30,
        issuedInvoices: [
          makeInvoice({
            id: 'a',
            status: 'pending_send',
            updated_at: '2025-01-01T00:00:00.000Z',
          }),
        ],
      }),
    );
    expect(sigs[0].category).toBe('invoice_pending_send');
    expect(sigs[0].severity).toBe('critical');
  });

  test('draft with total > 0 → invoice_draft_pending (medium)', () => {
    // Provide a complete recipient snapshot so we isolate the draft-pending
    // signal from the new (Phase C.1) missing_recipient_data signal.
    const sigs = deriveBillingAttention(
      input({
        issuedInvoices: [
          makeInvoice({
            id: 'a',
            status: 'draft',
            total_amount_cents: 5000,
            recipient_billing_snapshot: {
              billing_name: 'X',
              billing_address_1: '1',
              billing_city: 'Berlin',
              billing_country: 'DE',
              billing_email: 'b@x.test',
            },
          }),
        ],
      }),
    );
    expect(sigs).toHaveLength(1);
    expect(sigs[0].category).toBe('invoice_draft_pending');
    expect(sigs[0].severity).toBe('medium');
  });

  test('draft with total = 0 → no signal (empty scratchpad)', () => {
    const sigs = deriveBillingAttention(
      input({
        issuedInvoices: [makeInvoice({ id: 'a', status: 'draft', total_amount_cents: 0 })],
      }),
    );
    expect(sigs).toEqual([]);
  });
});

describe('deriveBillingAttention — invoice_payment_failed (Phase C.1 / 20261123)', () => {
  test('sent invoice with last_stripe_failure_at → invoice_payment_failed (critical)', () => {
    const sigs = deriveBillingAttention(
      input({
        issuedInvoices: [
          makeInvoice({
            id: 'a',
            status: 'sent',
            due_date: '2026-05-01',
            last_stripe_failure_at: '2026-04-18T10:00:00.000Z',
            last_stripe_failure_reason: 'card_declined',
          }),
        ],
      }),
    );
    const cats = sigs.map((s) => s.category);
    // Both signals must surface — failure is independent of unpaid/overdue.
    expect(cats).toContain('invoice_payment_failed');
    expect(cats).toContain('invoice_unpaid');
    const failure = sigs.find((s) => s.category === 'invoice_payment_failed')!;
    expect(failure.severity).toBe('critical');
    expect(failure.date).toBe('2026-04-18T10:00:00.000Z');
  });

  test('overdue invoice with failure → both invoice_overdue AND invoice_payment_failed', () => {
    const sigs = deriveBillingAttention(
      input({
        issuedInvoices: [
          makeInvoice({
            id: 'a',
            status: 'overdue',
            due_date: '2026-04-01',
            last_stripe_failure_at: '2026-04-15T00:00:00.000Z',
          }),
        ],
      }),
    );
    const cats = sigs.map((s) => s.category);
    expect(cats).toContain('invoice_overdue');
    expect(cats).toContain('invoice_payment_failed');
  });

  test('paid / void / uncollectible never trigger payment_failed even with failure_at set', () => {
    const sigs = deriveBillingAttention(
      input({
        issuedInvoices: [
          makeInvoice({
            id: 'a',
            status: 'paid',
            last_stripe_failure_at: '2026-04-01T00:00:00.000Z',
          }),
          makeInvoice({
            id: 'b',
            status: 'void',
            last_stripe_failure_at: '2026-04-01T00:00:00.000Z',
          }),
          makeInvoice({
            id: 'c',
            status: 'uncollectible',
            last_stripe_failure_at: '2026-04-01T00:00:00.000Z',
          }),
        ],
      }),
    );
    expect(sigs).toEqual([]);
  });

  test('payment_failed visible only to agency roles, never to clients', () => {
    expect(billingCategoryRoles('invoice_payment_failed')).toEqual([
      'agency_owner',
      'agency_member',
    ]);
  });
});

describe('deriveBillingAttention — invoice_missing_recipient_data (Phase C.1)', () => {
  const completeSnapshot = {
    billing_name: 'Acme Corp',
    billing_address_1: '1 Main St',
    billing_city: 'Berlin',
    billing_country: 'DE',
    billing_email: 'billing@acme.test',
  };

  test('draft with non-zero total + null snapshot → both draft_pending AND missing_recipient_data', () => {
    const sigs = deriveBillingAttention(
      input({
        issuedInvoices: [
          makeInvoice({
            id: 'a',
            status: 'draft',
            total_amount_cents: 5000,
            recipient_billing_snapshot: null,
          }),
        ],
      }),
    );
    const cats = sigs.map((s) => s.category);
    expect(cats).toContain('invoice_draft_pending');
    expect(cats).toContain('invoice_missing_recipient_data');
    const missing = sigs.find((s) => s.category === 'invoice_missing_recipient_data')!;
    expect(missing.severity).toBe('high');
  });

  test('draft with non-zero total + complete snapshot → only draft_pending', () => {
    const sigs = deriveBillingAttention(
      input({
        issuedInvoices: [
          makeInvoice({
            id: 'a',
            status: 'draft',
            total_amount_cents: 5000,
            recipient_billing_snapshot: completeSnapshot,
          }),
        ],
      }),
    );
    const cats = sigs.map((s) => s.category);
    expect(cats).toContain('invoice_draft_pending');
    expect(cats).not.toContain('invoice_missing_recipient_data');
  });

  test('draft with non-zero total + snapshot missing one required field → missing_recipient_data', () => {
    const incomplete = { ...completeSnapshot, billing_email: '' };
    const sigs = deriveBillingAttention(
      input({
        issuedInvoices: [
          makeInvoice({
            id: 'a',
            status: 'draft',
            total_amount_cents: 5000,
            recipient_billing_snapshot: incomplete,
          }),
        ],
      }),
    );
    expect(sigs.map((s) => s.category)).toContain('invoice_missing_recipient_data');
  });

  test('draft with total = 0 → no missing_recipient signal (empty scratchpad)', () => {
    const sigs = deriveBillingAttention(
      input({
        issuedInvoices: [
          makeInvoice({
            id: 'a',
            status: 'draft',
            total_amount_cents: 0,
            recipient_billing_snapshot: null,
          }),
        ],
      }),
    );
    expect(sigs).toEqual([]);
  });

  test('non-draft status never triggers missing_recipient_data even with null snapshot', () => {
    const sigs = deriveBillingAttention(
      input({
        issuedInvoices: [
          makeInvoice({
            id: 'a',
            status: 'sent',
            due_date: '2026-05-01',
            recipient_billing_snapshot: null,
          }),
        ],
      }),
    );
    expect(sigs.map((s) => s.category)).not.toContain('invoice_missing_recipient_data');
  });

  test('missing_recipient_data visible only to agency roles, never to clients', () => {
    expect(billingCategoryRoles('invoice_missing_recipient_data')).toEqual([
      'agency_owner',
      'agency_member',
    ]);
  });
});

describe('deriveBillingAttention — received invoices', () => {
  test('sent + due in past → invoice_received_overdue (critical)', () => {
    const sigs = deriveBillingAttention(
      input({
        receivedInvoices: [makeInvoice({ id: 'a', status: 'sent', due_date: '2026-04-01' })],
      }),
    );
    expect(sigs[0].category).toBe('invoice_received_overdue');
    expect(sigs[0].severity).toBe('critical');
  });

  test('sent + due in future → invoice_received_unpaid (high)', () => {
    const sigs = deriveBillingAttention(
      input({
        receivedInvoices: [makeInvoice({ id: 'a', status: 'sent', due_date: '2026-05-01' })],
      }),
    );
    expect(sigs[0].category).toBe('invoice_received_unpaid');
  });

  test('explicit overdue status → invoice_received_overdue', () => {
    const sigs = deriveBillingAttention(
      input({
        receivedInvoices: [makeInvoice({ id: 'a', status: 'overdue' })],
      }),
    );
    expect(sigs[0].category).toBe('invoice_received_overdue');
  });

  test('paid / draft / pending_send never surface to recipient', () => {
    const sigs = deriveBillingAttention(
      input({
        receivedInvoices: [
          makeInvoice({ id: 'a', status: 'paid' }),
          makeInvoice({ id: 'b', status: 'draft' }),
          makeInvoice({ id: 'c', status: 'pending_send' }),
        ],
      }),
    );
    expect(sigs).toEqual([]);
  });
});

describe('deriveBillingAttention — settlements', () => {
  test('draft + net > 0 → settlement_draft_pending (low)', () => {
    const sigs = deriveBillingAttention(
      input({
        settlements: [makeSettlement({ id: 's', status: 'draft', net_amount_cents: 1000 })],
      }),
    );
    expect(sigs[0].category).toBe('settlement_draft_pending');
    expect(sigs[0].severity).toBe('low');
  });

  test('draft + net = 0 → no signal', () => {
    const sigs = deriveBillingAttention(
      input({
        settlements: [makeSettlement({ id: 's', status: 'draft', net_amount_cents: 0 })],
      }),
    );
    expect(sigs).toEqual([]);
  });

  test('recorded → settlement_recorded_unpaid (medium)', () => {
    const sigs = deriveBillingAttention(
      input({
        settlements: [makeSettlement({ id: 's', status: 'recorded' })],
      }),
    );
    expect(sigs[0].category).toBe('settlement_recorded_unpaid');
    expect(sigs[0].severity).toBe('medium');
  });

  test('paid / void → no signal', () => {
    const sigs = deriveBillingAttention(
      input({
        settlements: [
          makeSettlement({ id: 'a', status: 'paid' }),
          makeSettlement({ id: 'b', status: 'void' }),
        ],
      }),
    );
    expect(sigs).toEqual([]);
  });
});

describe('deriveBillingAttention — billing profile gap', () => {
  test('hasBillingProfile=false → billing_profile_missing (high)', () => {
    const sigs = deriveBillingAttention(input({ hasBillingProfile: false }));
    expect(sigs[0].category).toBe('billing_profile_missing');
    expect(sigs[0].severity).toBe('high');
  });

  test('hasBillingProfile=true → no signal', () => {
    expect(deriveBillingAttention(input({ hasBillingProfile: true }))).toEqual([]);
  });

  test('hasBillingProfile undefined → no signal (unknown ≠ missing)', () => {
    expect(deriveBillingAttention(input({}))).toEqual([]);
  });
});

describe('deriveBillingAttention — sorting', () => {
  test('sorts by severity rank (critical → high → medium → low)', () => {
    const completeSnapshot = {
      billing_name: 'X',
      billing_address_1: '1',
      billing_city: 'Berlin',
      billing_country: 'DE',
      billing_email: 'b@x.test',
    };
    const sigs = deriveBillingAttention(
      input({
        issuedInvoices: [
          // complete snapshot → only draft_pending fires, isolating the test
          // from the (Phase C.1) missing_recipient_data signal.
          makeInvoice({
            id: 'draft',
            status: 'draft',
            total_amount_cents: 100,
            recipient_billing_snapshot: completeSnapshot,
          }),
          makeInvoice({ id: 'sent', status: 'sent', due_date: '2026-04-01' }),
          makeInvoice({ id: 'unpaid', status: 'sent', due_date: '2026-05-01' }),
        ],
        settlements: [makeSettlement({ id: 's', status: 'draft', net_amount_cents: 1 })],
      }),
    );
    const cats = sigs.map((s) => s.category);
    expect(cats[0]).toBe('invoice_overdue');
    expect(cats[1]).toBe('invoice_unpaid');
    expect(cats[2]).toBe('invoice_draft_pending');
    expect(cats[3]).toBe('settlement_draft_pending');
  });
});

describe('billingCategoryRoles + filterBillingAttentionForRole', () => {
  test('settlement categories agency-only (no client roles)', () => {
    expect(billingCategoryRoles('settlement_draft_pending')).toEqual([
      'agency_owner',
      'agency_member',
    ]);
    expect(billingCategoryRoles('settlement_recorded_unpaid')).toEqual([
      'agency_owner',
      'agency_member',
    ]);
  });

  test('received invoices visible to clients + agency', () => {
    expect(billingCategoryRoles('invoice_received_overdue')).toContain('client_owner');
    expect(billingCategoryRoles('invoice_received_overdue')).toContain('client_member');
  });

  test('filterBillingAttentionForRole hides agency-only signals from client', () => {
    const sigs = deriveBillingAttention(
      input({
        settlements: [makeSettlement({ id: 's', status: 'recorded' })],
        receivedInvoices: [makeInvoice({ id: 'r', status: 'sent', due_date: '2026-04-01' })],
      }),
    );
    const clientView = filterBillingAttentionForRole(sigs, 'client_owner');
    expect(clientView.map((s) => s.category)).toEqual(['invoice_received_overdue']);

    const agencyView = filterBillingAttentionForRole(sigs, 'agency_owner');
    expect(agencyView.map((s) => s.category).sort()).toEqual(
      ['invoice_received_overdue', 'settlement_recorded_unpaid'].sort(),
    );
  });
});

describe('billingTabBadgeForRole + highestBillingSeverityForRole', () => {
  test('badge true when any visible signal exists', () => {
    const sigs = deriveBillingAttention(
      input({ settlements: [makeSettlement({ id: 's', status: 'draft', net_amount_cents: 1 })] }),
    );
    expect(billingTabBadgeForRole(sigs, 'agency_owner')).toBe(true);
    expect(billingTabBadgeForRole(sigs, 'client_owner')).toBe(false);
  });

  test('badge false on empty signals', () => {
    expect(billingTabBadgeForRole([], 'agency_owner')).toBe(false);
  });

  test('highestBillingSeverityForRole returns critical when overdue + settlement', () => {
    const sigs = deriveBillingAttention(
      input({
        issuedInvoices: [makeInvoice({ id: 'a', status: 'overdue' })],
        settlements: [makeSettlement({ id: 's', status: 'draft', net_amount_cents: 1 })],
      }),
    );
    expect(highestBillingSeverityForRole(sigs, 'agency_owner')).toBe('critical');
  });

  test('highestBillingSeverityForRole returns null when no visible signals', () => {
    expect(highestBillingSeverityForRole([], 'agency_owner')).toBeNull();
  });
});
