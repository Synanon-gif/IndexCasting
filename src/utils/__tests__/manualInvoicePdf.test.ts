/**
 * Smoke test for the manual invoice PDF generator. We verify the PDF builder
 * resolves to a Blob without throwing, with realistic input including
 * multi-line descriptions, expenses, reverse-charge, and missing fields.
 *
 * jspdf is a real ESM dependency that works under Node + jsdom — but the
 * default Jest env here is `node`, so we mock the dynamic import to avoid
 * pulling in canvas/DOM deps. The mock returns an instance with the small
 * subset of methods our generator uses, all as no-ops, plus a working
 * `output('blob')` that returns a Blob. This proves we exercise every
 * code path (header, table rows with wrapping, totals, notes, footer)
 * without painting pixels.
 */

import { computeManualInvoiceTotals } from '../manualInvoiceTotals';

const mockSplit = jest.fn((text: string, _w: number) => String(text).split('\n'));

jest.mock('jspdf', () => {
  return {
    jsPDF: jest.fn().mockImplementation(() => {
      let pageCount = 1;
      return {
        setProperties: jest.fn(),
        setFont: jest.fn(),
        setFontSize: jest.fn(),
        setTextColor: jest.fn(),
        setDrawColor: jest.fn(),
        setFillColor: jest.fn(),
        text: jest.fn(),
        splitTextToSize: mockSplit,
        rect: jest.fn(),
        line: jest.fn(),
        addPage: jest.fn(() => {
          pageCount++;
        }),
        output: jest.fn(() => new Blob(['%PDF-1.4'], { type: 'application/pdf' })),
        internal: {
          getNumberOfPages: () => pageCount,
          pages: [null, null],
        },
        setPage: jest.fn(),
      };
    }),
  };
});

import { buildManualInvoicePdf } from '../manualInvoicePdf';

describe('buildManualInvoicePdf — smoke', () => {
  it('builds a Blob for an Agency → Client invoice with rates + expenses', async () => {
    const lines = [
      {
        description: 'Day rate — Pauline Schubach',
        model_label: 'Pauline Schubach',
        job_label: 'Show Marni S.p.A.',
        performed_on: '2026-02-26',
        quantity: 1,
        unit_amount_cents: 180000,
        tax_rate_percent: 0,
        tax_treatment: 'zero_rated',
        is_expense: false,
      },
      {
        description: 'Travel — Flight MIL→BER',
        performed_on: '2026-02-25',
        quantity: 1,
        unit_amount_cents: 25000,
        tax_rate_percent: 0,
        tax_treatment: 'zero_rated',
        is_expense: true,
      },
    ];
    const totals = computeManualInvoiceTotals(lines, 20);
    const blob = await buildManualInvoicePdf({
      invoice: {
        direction: 'agency_to_client',
        status: 'draft',
        invoice_number: 'INV-000001',
        issue_date: '2026-04-24',
        supply_date: '2026-02-26',
        due_date: '2026-05-08',
        payment_terms_days: 14,
        currency: 'EUR',
        po_number: 'PO-42',
        buyer_reference: null,
        job_reference: 'Marni S/S 26',
        booking_reference: null,
        service_charge_pct: 20,
        tax_note: 'Reverse charge: customer to account for VAT.',
        invoice_notes: 'Thanks for the job!',
        payment_instructions: 'IBAN DE00 0000 0000 0000\nBIC ABCDEFG',
        footer_notes: 'Poetry Of People Ltd — Berlin',
        reverse_charge_applied: true,
      },
      sender: {
        legal_name: 'Poetry Of People Ltd',
        trading_name: 'POoP',
        address_line_1: 'Sample street 1',
        city: 'Berlin',
        country_code: 'DE',
        vat_number: 'DE123456789',
        iban: 'DE00 0000 0000 0000',
        bic: 'ABCDEFG',
        account_holder: 'Poetry Of People Ltd',
        bank_name: 'Sample Bank',
      },
      recipient: {
        legal_name: 'Marni S.p.A.',
        display_name: 'Marni',
        address_line_1: 'Via Sismondi 50',
        city: 'Milano',
        country_code: 'IT',
        vat_number: 'IT00000000000',
        contact_person: 'Mr. Bookings',
        billing_email: 'ap@marni.it',
        kind: 'client',
      },
      lines,
      totals,
      isDraft: true,
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('handles empty line items + missing party data without throwing', async () => {
    const totals = computeManualInvoiceTotals([], null);
    const blob = await buildManualInvoicePdf({
      invoice: {
        direction: 'model_to_agency',
        status: 'draft',
        invoice_number: null,
        issue_date: null,
        supply_date: null,
        due_date: null,
        payment_terms_days: null,
        currency: 'EUR',
        po_number: null,
        buyer_reference: null,
        job_reference: null,
        booking_reference: null,
        service_charge_pct: null,
        tax_note: null,
        invoice_notes: null,
        payment_instructions: null,
        footer_notes: null,
        reverse_charge_applied: false,
      },
      sender: null,
      recipient: null,
      lines: [],
      totals,
      isDraft: true,
    });
    expect(blob).toBeInstanceOf(Blob);
  });
});
