import {
  computeLineGrossCents,
  computeLineNetCents,
  computeLineTaxCents,
  computeManualInvoiceTotals,
  formatMoneyCents,
} from '../manualInvoiceTotals';

describe('manualInvoiceTotals — single line', () => {
  it('computes net = quantity × unit', () => {
    expect(computeLineNetCents({ quantity: 2, unit_amount_cents: 12345 })).toBe(24690);
  });

  it('treats missing quantity as 1, missing unit as 0', () => {
    expect(computeLineNetCents({})).toBe(0);
    expect(computeLineNetCents({ unit_amount_cents: 500 })).toBe(500);
  });

  it('rounds non-integer multiplications safely', () => {
    expect(computeLineNetCents({ quantity: 1.333, unit_amount_cents: 100 })).toBe(133);
  });

  it('computes tax from rate (0% / 19% / 20% / null)', () => {
    expect(
      computeLineTaxCents({ quantity: 1, unit_amount_cents: 10000, tax_rate_percent: 0 }),
    ).toBe(0);
    expect(
      computeLineTaxCents({ quantity: 1, unit_amount_cents: 10000, tax_rate_percent: 19 }),
    ).toBe(1900);
    expect(
      computeLineTaxCents({ quantity: 1, unit_amount_cents: 10000, tax_rate_percent: 20 }),
    ).toBe(2000);
    expect(
      computeLineTaxCents({ quantity: 1, unit_amount_cents: 10000, tax_rate_percent: null }),
    ).toBe(0);
  });

  it('gross = net + tax', () => {
    expect(
      computeLineGrossCents({
        quantity: 1,
        unit_amount_cents: 10000,
        tax_rate_percent: 19,
      }),
    ).toBe(11900);
  });
});

describe('manualInvoiceTotals — invoice aggregate', () => {
  it('returns zeros for an empty invoice', () => {
    const t = computeManualInvoiceTotals([]);
    expect(t.subtotal_rates_cents).toBe(0);
    expect(t.subtotal_expenses_cents).toBe(0);
    expect(t.service_charge_cents).toBe(0);
    expect(t.tax_total_cents).toBe(0);
    expect(t.grand_total_cents).toBe(0);
    expect(t.vat_breakdown).toEqual([]);
  });

  it('separates rates and expenses', () => {
    const t = computeManualInvoiceTotals([
      { quantity: 1, unit_amount_cents: 100000, is_expense: false },
      { quantity: 1, unit_amount_cents: 25000, is_expense: true },
    ]);
    expect(t.subtotal_rates_cents).toBe(100000);
    expect(t.subtotal_expenses_cents).toBe(25000);
    expect(t.net_total_before_service_cents).toBe(125000);
    expect(t.tax_total_cents).toBe(0);
    expect(t.grand_total_cents).toBe(125000);
  });

  it('applies service charge on (rates + expenses) net', () => {
    const t = computeManualInvoiceTotals([{ quantity: 1, unit_amount_cents: 100000 }], 20);
    expect(t.service_charge_cents).toBe(20000);
    expect(t.grand_total_cents).toBe(120000);
  });

  it('groups VAT by rate + treatment', () => {
    const t = computeManualInvoiceTotals([
      { quantity: 1, unit_amount_cents: 10000, tax_rate_percent: 19 },
      { quantity: 1, unit_amount_cents: 5000, tax_rate_percent: 19 },
      {
        quantity: 1,
        unit_amount_cents: 8000,
        tax_rate_percent: 0,
        tax_treatment: 'reverse_charge',
      },
    ]);
    expect(t.vat_breakdown).toHaveLength(2);
    const reverse = t.vat_breakdown.find((b) => b.treatment === 'reverse_charge');
    const standard = t.vat_breakdown.find((b) => b.rate_percent === 19);
    expect(reverse).toBeDefined();
    expect(reverse?.net_cents).toBe(8000);
    expect(reverse?.tax_cents).toBe(0);
    expect(standard?.net_cents).toBe(15000);
    expect(standard?.tax_cents).toBe(2850);
  });

  it('handles a representative agency-to-client invoice end to end', () => {
    const t = computeManualInvoiceTotals(
      [
        // Day rates (rates side)
        { quantity: 1, unit_amount_cents: 180000 }, // day rate model A
        { quantity: 1, unit_amount_cents: 90000 }, // half day model A
        // Expenses (zero-rated UK style)
        {
          quantity: 1,
          unit_amount_cents: 25000,
          is_expense: true,
          tax_rate_percent: 0,
          tax_treatment: 'zero_rated',
        },
        {
          quantity: 1,
          unit_amount_cents: 4500,
          is_expense: true,
          tax_rate_percent: 0,
          tax_treatment: 'zero_rated',
        },
      ],
      20, // 20% service charge
    );
    expect(t.subtotal_rates_cents).toBe(270000);
    expect(t.subtotal_expenses_cents).toBe(29500);
    expect(t.service_charge_cents).toBe(59900); // 20% of 299_500
    expect(t.tax_total_cents).toBe(0);
    expect(t.grand_total_cents).toBe(359400);
    expect(t.vat_breakdown).toEqual([
      { rate_percent: null, treatment: null, net_cents: 270000, tax_cents: 0 },
      {
        rate_percent: 0,
        treatment: 'zero_rated',
        net_cents: 29500,
        tax_cents: 0,
      },
    ]);
  });

  it('treats non-finite quantity as 1 (single unit) and allows negative expenses', () => {
    const t = computeManualInvoiceTotals([
      { quantity: NaN, unit_amount_cents: 1000 },
      { quantity: 1, unit_amount_cents: -500, is_expense: true },
    ]);
    expect(t.subtotal_rates_cents).toBe(1000);
    expect(t.subtotal_expenses_cents).toBe(-500);
    expect(t.grand_total_cents).toBe(500);
  });

  it('treats non-finite unit_amount_cents as 0 (no contribution)', () => {
    const t = computeManualInvoiceTotals([
      { quantity: 5, unit_amount_cents: NaN as unknown as number },
    ]);
    expect(t.subtotal_rates_cents).toBe(0);
    expect(t.grand_total_cents).toBe(0);
  });
});

describe('formatMoneyCents', () => {
  it('formats positive cents correctly', () => {
    expect(formatMoneyCents(123456, 'EUR')).toBe('1,234.56 EUR');
    expect(formatMoneyCents(99, 'EUR')).toBe('0.99 EUR');
    expect(formatMoneyCents(0, 'GBP')).toBe('0.00 GBP');
  });

  it('handles negatives', () => {
    expect(formatMoneyCents(-12300, 'USD')).toBe('-123.00 USD');
  });

  it('falls back to 0 for invalid input', () => {
    expect(formatMoneyCents(null, 'EUR')).toBe('0.00 EUR');
    expect(formatMoneyCents(undefined, 'EUR')).toBe('0.00 EUR');
  });
});
