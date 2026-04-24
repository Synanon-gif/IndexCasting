/**
 * Pure totals helper for the Manual Invoice feature.
 *
 * Inputs are line items (in cents) plus optional service charge percentage.
 * Outputs are aggregate totals + VAT breakdown grouped by rate/treatment.
 *
 * No side effects, no DB calls — fully unit-testable.
 */

import type {
  ManualInvoiceLineItemInput,
  ManualInvoiceLineItemRow,
  ManualInvoiceTotals,
} from '../types/manualBillingTypes';

type LineLike = Partial<ManualInvoiceLineItemRow> & {
  quantity?: number;
  unit_amount_cents?: number;
  tax_rate_percent?: number | null;
  tax_treatment?: string | null;
  is_expense?: boolean;
};

/**
 * Round half-away-from-zero (banker-safe enough for invoice cents).
 */
function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

/**
 * Compute net amount in cents for a single line.
 * net = quantity * unit_amount_cents
 */
export function computeLineNetCents(line: LineLike): number {
  const qty = Number.isFinite(line.quantity ?? NaN) ? Number(line.quantity) : 1;
  const unit = Number.isFinite(line.unit_amount_cents ?? NaN) ? Number(line.unit_amount_cents) : 0;
  return roundCents(qty * unit);
}

/**
 * Compute tax amount in cents for a single line.
 * tax = round(net * rate / 100). Falls back to 0 if rate is null/undefined/<0.
 */
export function computeLineTaxCents(line: LineLike, netCents?: number): number {
  const net = netCents ?? computeLineNetCents(line);
  const rate = line.tax_rate_percent;
  if (rate == null || !Number.isFinite(rate) || rate < 0) return 0;
  return roundCents((net * Number(rate)) / 100);
}

/** Convenience: net + tax. */
export function computeLineGrossCents(line: LineLike): number {
  const net = computeLineNetCents(line);
  const tax = computeLineTaxCents(line, net);
  return net + tax;
}

/**
 * Aggregate totals across all line items + optional service charge percentage.
 *
 * Service charge is computed on the (rates + expenses) net subtotal — it's
 * itself untaxed in this Phase 1 (a real tax engine can be plugged later).
 *
 * VAT breakdown is grouped by `(rate_percent, treatment)`. A null rate is
 * preserved so reverse-charge / zero-rated lines remain explicit.
 */
export function computeManualInvoiceTotals(
  lines: ReadonlyArray<LineLike>,
  serviceChargePct?: number | null,
): ManualInvoiceTotals {
  let subtotalRates = 0;
  let subtotalExpenses = 0;
  let taxTotal = 0;

  type Bucket = {
    rate_percent: number | null;
    treatment: string | null;
    net_cents: number;
    tax_cents: number;
  };
  const buckets = new Map<string, Bucket>();

  for (const line of lines) {
    const net = computeLineNetCents(line);
    const tax = computeLineTaxCents(line, net);
    const isExpense = line.is_expense === true;

    if (isExpense) subtotalExpenses += net;
    else subtotalRates += net;

    taxTotal += tax;

    const ratePart =
      line.tax_rate_percent == null || !Number.isFinite(line.tax_rate_percent)
        ? 'null'
        : String(line.tax_rate_percent);
    const trtPart = (line.tax_treatment ?? '').trim() || 'unspecified';
    const key = `${ratePart}::${trtPart}`;

    const existing = buckets.get(key);
    if (existing) {
      existing.net_cents += net;
      existing.tax_cents += tax;
    } else {
      buckets.set(key, {
        rate_percent:
          line.tax_rate_percent == null || !Number.isFinite(line.tax_rate_percent)
            ? null
            : Number(line.tax_rate_percent),
        treatment: line.tax_treatment ?? null,
        net_cents: net,
        tax_cents: tax,
      });
    }
  }

  const netBeforeService = subtotalRates + subtotalExpenses;

  let serviceCharge = 0;
  if (serviceChargePct != null && Number.isFinite(serviceChargePct) && serviceChargePct > 0) {
    serviceCharge = roundCents((netBeforeService * Number(serviceChargePct)) / 100);
  }

  const grandTotal = netBeforeService + serviceCharge + taxTotal;

  return {
    subtotal_rates_cents: subtotalRates,
    subtotal_expenses_cents: subtotalExpenses,
    net_total_before_service_cents: netBeforeService,
    service_charge_cents: serviceCharge,
    tax_total_cents: taxTotal,
    grand_total_cents: grandTotal,
    vat_breakdown: Array.from(buckets.values()).sort((a, b) => {
      const ar = a.rate_percent == null ? -1 : a.rate_percent;
      const br = b.rate_percent == null ? -1 : b.rate_percent;
      if (ar !== br) return ar - br;
      return (a.treatment ?? '').localeCompare(b.treatment ?? '');
    }),
  };
}

/** Convert a ManualInvoiceLineItemInput to a LineLike for totals computation. */
export function toLineLike(input: ManualInvoiceLineItemInput): LineLike {
  return {
    quantity: input.quantity,
    unit_amount_cents: input.unit_amount_cents,
    tax_rate_percent: input.tax_rate_percent ?? null,
    tax_treatment: input.tax_treatment ?? null,
    is_expense: input.is_expense ?? false,
  };
}

/**
 * Format cents to a human display string. Currency is appended without locale
 * lookup (Phase 1) so output is deterministic across platforms.
 */
export function formatMoneyCents(
  cents: number | null | undefined,
  currency: string = 'EUR',
): string {
  const safe = cents == null || !Number.isFinite(cents) ? 0 : Number(cents);
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = (abs % 100).toString().padStart(2, '0');
  return `${sign}${whole}.${frac} ${currency}`;
}
