/**
 * Manual Invoice PDF generator (web, frontend-only via jspdf).
 *
 * Strictly separate from `pdfExport.ts` (the model PDF) so layout changes here
 * cannot break casting exports. No backend, no external API.
 *
 * Layout rules (kept simple + safe so multi-page wraps cleanly):
 *   - A4 portrait, 15mm margins
 *   - Two top blocks: Supplier (left) + Invoice meta + Bill To (right)
 *   - Single line item table with auto-wrapping description column
 *   - Totals box bottom-right; tax note + payment instructions full-width
 *   - Page footer with page numbers
 *
 * Inputs are tolerant of `null` so we can render either a draft preview
 * (snapshot fields not yet frozen) or a generated invoice.
 */

import { uiCopy } from '../constants/uiCopy';
import { formatMoneyCents } from './manualInvoiceTotals';
import type {
  ManualBillingAgencyProfileRow,
  ManualBillingCounterpartyRow,
  ManualInvoiceLineItemInput,
  ManualInvoiceLineItemRow,
  ManualInvoiceRow,
  ManualInvoiceTotals,
} from '../types/manualBillingTypes';

const PAGE_W = 210; // mm
const PAGE_H = 297; // mm
const MARGIN = 15;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const FOOTER_RESERVE = 18;
const ROW_PAD = 2;

type PartyLike =
  | (Partial<ManualBillingAgencyProfileRow> & { kind?: undefined })
  | (Partial<ManualBillingCounterpartyRow> & { kind?: 'client' | 'model' });

type AnyLine =
  | ManualInvoiceLineItemRow
  | (ManualInvoiceLineItemInput & {
      net_amount_cents?: number;
      tax_amount_cents?: number;
      gross_amount_cents?: number;
    });

export type ManualInvoicePdfInput = {
  invoice: Pick<
    ManualInvoiceRow,
    | 'direction'
    | 'status'
    | 'invoice_number'
    | 'issue_date'
    | 'supply_date'
    | 'due_date'
    | 'payment_terms_days'
    | 'currency'
    | 'po_number'
    | 'buyer_reference'
    | 'job_reference'
    | 'booking_reference'
    | 'service_charge_pct'
    | 'tax_note'
    | 'invoice_notes'
    | 'payment_instructions'
    | 'footer_notes'
    | 'reverse_charge_applied'
  >;
  sender: PartyLike | null;
  recipient: PartyLike | null;
  lines: AnyLine[];
  totals: ManualInvoiceTotals;
  isDraft?: boolean;
};

type JsPDFInstance = {
  setProperties: (props: { title?: string }) => void;
  setFont: (name: string, style: 'normal' | 'bold' | 'italic') => void;
  setFontSize: (size: number) => void;
  setTextColor: (r: number, g: number, b: number) => void;
  setDrawColor: (r: number, g: number, b: number) => void;
  setFillColor: (r: number, g: number, b: number) => void;
  text: (text: string, x: number, y: number, opts?: Record<string, unknown>) => void;
  splitTextToSize: (text: string, maxWidth: number) => string[];
  rect: (x: number, y: number, w: number, h: number, style?: 'F' | 'S' | 'FD') => void;
  line: (x1: number, y1: number, x2: number, y2: number) => void;
  addPage: () => void;
  output: (
    type: 'blob' | 'datauristring' | 'bloburl' | 'arraybuffer',
  ) => Blob | string | ArrayBuffer;
  internal: { getNumberOfPages: () => number; pages: unknown[] };
  setPage: (page: number) => void;
};

// ── helpers ───────────────────────────────────────────────────────────────

function safeText(value: string | null | undefined): string {
  if (value == null) return '';
  return String(value)
    .replace(/\u0000/g, '')
    .trim();
}

function joinNonEmpty(parts: Array<string | null | undefined>, sep: string): string {
  return parts
    .map(safeText)
    .filter((p) => p.length > 0)
    .join(sep);
}

function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return '';
  // We want "2026-04-24" — strip any time component, never localize.
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : safeText(iso);
}

function partyLines(party: PartyLike | null): {
  legalName: string;
  tradingName: string;
  addressLines: string[];
  meta: string[];
  bank: string[];
  contact: string[];
} {
  if (!party) {
    return { legalName: '', tradingName: '', addressLines: [], meta: [], bank: [], contact: [] };
  }
  // Both Agency and Counterparty share these column names.
  const p = party as Record<string, unknown>;
  const legalName = safeText(p.legal_name as string | null | undefined);
  const tradingName = safeText(
    (p.trading_name as string | null | undefined) ?? (p.display_name as string | null | undefined),
  );

  const addressLines = [
    safeText(p.address_line_1 as string | null | undefined),
    safeText(p.address_line_2 as string | null | undefined),
    joinNonEmpty(
      [p.postal_code as string | null | undefined, p.city as string | null | undefined],
      ' ',
    ),
    joinNonEmpty(
      [p.state as string | null | undefined, p.country_code as string | null | undefined],
      ', ',
    ),
  ].filter((l) => l.length > 0);

  const meta: string[] = [];
  if (p.company_registration_number)
    meta.push(`Reg. ${safeText(p.company_registration_number as string)}`);
  if (p.vat_number) meta.push(`VAT ${safeText(p.vat_number as string)}`);
  if (p.tax_number) meta.push(`Tax ${safeText(p.tax_number as string)}`);

  const bank: string[] = [];
  if (p.account_holder)
    bank.push(
      `${uiCopy.manualBilling.pdfBankAccountHolder}: ${safeText(p.account_holder as string)}`,
    );
  if (p.bank_name)
    bank.push(`${uiCopy.manualBilling.pdfBankName}: ${safeText(p.bank_name as string)}`);
  if (p.iban) bank.push(`${uiCopy.manualBilling.pdfIban}: ${safeText(p.iban as string)}`);
  if (p.bic) bank.push(`${uiCopy.manualBilling.pdfBic}: ${safeText(p.bic as string)}`);

  const contact: string[] = [];
  if (p.contact_person) contact.push(safeText(p.contact_person as string));
  if (p.billing_email) contact.push(safeText(p.billing_email as string));
  else if (p.email) contact.push(safeText(p.email as string));
  if (p.phone) contact.push(safeText(p.phone as string));

  return { legalName, tradingName, addressLines, meta, bank, contact };
}

function ensureSpace(doc: JsPDFInstance, y: number, needed: number): number {
  if (y + needed > PAGE_H - MARGIN - FOOTER_RESERVE) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

function writeBlock(
  doc: JsPDFInstance,
  x: number,
  yIn: number,
  maxW: number,
  lines: string[],
  size: number,
  weight: 'normal' | 'bold' = 'normal',
): number {
  doc.setFont('helvetica', weight);
  doc.setFontSize(size);
  let y = yIn;
  for (const raw of lines) {
    const text = safeText(raw);
    if (!text) continue;
    const wrapped = doc.splitTextToSize(text, maxW);
    for (const w of wrapped) {
      doc.text(w, x, y);
      y += size * 0.45 + 1.2;
    }
  }
  return y;
}

function drawDraftWatermark(doc: JsPDFInstance): void {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(70);
  doc.setTextColor(220, 220, 220);
  // jspdf rotation needs angle option; without easy rotate we draw it flat
  doc.text(uiCopy.manualBilling.pdfDraftWatermark, PAGE_W / 2 - 40, PAGE_H / 2);
  doc.setTextColor(0, 0, 0);
}

function drawHeader(doc: JsPDFInstance, input: ManualInvoicePdfInput): number {
  const { invoice, sender, recipient } = input;
  const senderInfo = partyLines(sender);
  const recipientInfo = partyLines(recipient);

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(17, 17, 17);
  doc.text(uiCopy.manualBilling.pdfInvoiceLabel.toUpperCase(), MARGIN, MARGIN + 6);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  if (invoice.invoice_number) {
    doc.text(`#${safeText(invoice.invoice_number)}`, MARGIN, MARGIN + 11);
  }
  doc.setTextColor(17, 17, 17);

  let y = MARGIN + 18;

  // Two-column header: Supplier left (88mm) | Bill To right (88mm)
  const colW = (CONTENT_W - 4) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colW + 4;

  // Labels
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(uiCopy.manualBilling.pdfSupplierLabel.toUpperCase(), leftX, y);
  doc.text(uiCopy.manualBilling.pdfBillToLabel.toUpperCase(), rightX, y);
  doc.setTextColor(17, 17, 17);
  y += 4;

  // Names
  const leftStart = y;
  const rightStart = y;
  let leftY = writeBlock(
    doc,
    leftX,
    leftStart,
    colW,
    [senderInfo.legalName].filter(Boolean),
    12,
    'bold',
  );
  if (senderInfo.tradingName) {
    leftY = writeBlock(doc, leftX, leftY + 0.5, colW, [senderInfo.tradingName], 9, 'normal');
  }
  leftY = writeBlock(doc, leftX, leftY + 0.5, colW, senderInfo.addressLines, 9, 'normal');
  leftY = writeBlock(doc, leftX, leftY + 0.5, colW, senderInfo.meta, 8, 'normal');
  leftY = writeBlock(doc, leftX, leftY + 0.5, colW, senderInfo.contact, 8, 'normal');

  let rightY = writeBlock(
    doc,
    rightX,
    rightStart,
    colW,
    [recipientInfo.legalName].filter(Boolean),
    12,
    'bold',
  );
  if (recipientInfo.tradingName) {
    rightY = writeBlock(doc, rightX, rightY + 0.5, colW, [recipientInfo.tradingName], 9, 'normal');
  }
  rightY = writeBlock(doc, rightX, rightY + 0.5, colW, recipientInfo.addressLines, 9, 'normal');
  rightY = writeBlock(doc, rightX, rightY + 0.5, colW, recipientInfo.meta, 8, 'normal');
  rightY = writeBlock(doc, rightX, rightY + 0.5, colW, recipientInfo.contact, 8, 'normal');

  y = Math.max(leftY, rightY) + 3;

  // Invoice meta strip (full width, alternating label / value)
  doc.setDrawColor(226, 224, 219);
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
  y += 4;

  const allMetaPairs: Array<[string, string]> = [
    [uiCopy.manualBilling.pdfIssueDateLabel, formatDateOnly(invoice.issue_date)],
    [uiCopy.manualBilling.pdfSupplyDateLabel, formatDateOnly(invoice.supply_date)],
    [uiCopy.manualBilling.pdfDueDateLabel, formatDateOnly(invoice.due_date)],
    [
      uiCopy.manualBilling.pdfPaymentTermsLabel,
      invoice.payment_terms_days != null ? `${invoice.payment_terms_days} d` : '',
    ],
    [uiCopy.manualBilling.pdfCurrencyLabel, safeText(invoice.currency)],
    [
      uiCopy.manualBilling.pdfPoLabel,
      joinNonEmpty([invoice.po_number, invoice.buyer_reference], ' / '),
    ],
    [uiCopy.manualBilling.pdfJobLabel, safeText(invoice.job_reference)],
    [uiCopy.manualBilling.pdfBookingLabel, safeText(invoice.booking_reference)],
  ];
  const metaPairs: Array<[string, string]> = allMetaPairs.filter(
    (pair): pair is [string, string] => pair[1].length > 0,
  );

  // Render meta pairs in a 2-column grid
  doc.setFontSize(9);
  for (let i = 0; i < metaPairs.length; i += 2) {
    const a = metaPairs[i];
    const b = i + 1 < metaPairs.length ? metaPairs[i + 1] : null;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(120, 120, 120);
    doc.text(a[0].toUpperCase(), leftX, y);
    if (b) doc.text(b[0].toUpperCase(), rightX, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(17, 17, 17);
    doc.text(a[1], leftX, y);
    if (b) doc.text(b[1], rightX, y);
    y += 6;
  }

  return y + 1;
}

// ── Line items table ──────────────────────────────────────────────────────

type Col = { key: string; label: string; w: number; align?: 'left' | 'right' };

function lineColumns(): Col[] {
  // Widths must sum to CONTENT_W (180mm)
  return [
    { key: 'date', label: uiCopy.manualBilling.pdfLineColDate, w: 22 },
    { key: 'description', label: uiCopy.manualBilling.pdfLineColDescription, w: 88 },
    { key: 'qty', label: uiCopy.manualBilling.pdfLineColQty, w: 14, align: 'right' },
    { key: 'unit', label: uiCopy.manualBilling.pdfLineColUnit, w: 22, align: 'right' },
    { key: 'vat', label: uiCopy.manualBilling.pdfLineColVat, w: 12, align: 'right' },
    { key: 'amount', label: uiCopy.manualBilling.pdfLineColAmount, w: 22, align: 'right' },
  ];
}

function drawTableHeader(doc: JsPDFInstance, y: number, cols: Col[]): number {
  doc.setFillColor(240, 238, 233);
  doc.rect(MARGIN, y, CONTENT_W, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(60, 60, 60);
  let x = MARGIN + ROW_PAD;
  for (const col of cols) {
    const label = col.label.toUpperCase();
    if (col.align === 'right') {
      doc.text(label, x + col.w - 2 * ROW_PAD, y + 5, { align: 'right' } as Record<
        string,
        unknown
      >);
    } else {
      doc.text(label, x, y + 5);
    }
    x += col.w;
  }
  doc.setTextColor(17, 17, 17);
  return y + 7;
}

function lineNet(line: AnyLine): number {
  if ('net_amount_cents' in line && typeof line.net_amount_cents === 'number') {
    return line.net_amount_cents;
  }
  const qty = Number.isFinite(line.quantity) ? Number(line.quantity) : 1;
  const unit = Number.isFinite(line.unit_amount_cents) ? Number(line.unit_amount_cents) : 0;
  return Math.round(qty * unit);
}

function drawTableRow(
  doc: JsPDFInstance,
  yIn: number,
  cols: Col[],
  line: AnyLine,
  currency: string,
): number {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(17, 17, 17);

  // Build raw cells
  const date = formatDateOnly(line.performed_on as string | null | undefined);
  const desc = (() => {
    const desc1 = safeText(line.description);
    const meta = joinNonEmpty(
      [line.model_label as string | null | undefined, line.job_label as string | null | undefined],
      ' • ',
    );
    const notes = safeText(line.notes as string | null | undefined);
    return [desc1, meta, notes].filter(Boolean).join('\n');
  })();
  const qty = String(line.quantity ?? 1);
  const unit = formatMoneyCents(line.unit_amount_cents ?? 0, currency);
  const vat = (() => {
    const r = line.tax_rate_percent;
    const t = safeText(line.tax_treatment as string | null | undefined);
    if (r == null || !Number.isFinite(r)) return t || '—';
    return `${r}%${t ? ` (${t})` : ''}`;
  })();
  const amount = formatMoneyCents(lineNet(line), currency);

  // Wrap description (the only multi-line cell)
  const descCol = cols.find((c) => c.key === 'description')!;
  const descWrapped = doc.splitTextToSize(desc, descCol.w - 2 * ROW_PAD);
  const rowH = Math.max(7, descWrapped.length * 4.4 + ROW_PAD);

  // Page break?
  const y = ensureSpace(doc, yIn, rowH + 2);
  // If we broke, redraw header for clarity
  let cursor = y;
  if (y === MARGIN) {
    cursor = drawTableHeader(doc, MARGIN, cols);
  }

  // Subtle separator
  doc.setDrawColor(238, 236, 230);
  doc.line(MARGIN, cursor + rowH, MARGIN + CONTENT_W, cursor + rowH);

  let x = MARGIN + ROW_PAD;
  for (const col of cols) {
    let text = '';
    switch (col.key) {
      case 'date':
        text = date;
        break;
      case 'description':
        // Multi-line; render manually
        for (let i = 0; i < descWrapped.length; i++) {
          doc.text(descWrapped[i], x, cursor + 4.5 + i * 4.4);
        }
        x += col.w;
        continue;
      case 'qty':
        text = qty;
        break;
      case 'unit':
        text = unit;
        break;
      case 'vat':
        text = vat;
        break;
      case 'amount':
        text = amount;
        break;
    }
    if (col.align === 'right') {
      doc.text(text, x + col.w - 2 * ROW_PAD, cursor + 4.5, { align: 'right' } as Record<
        string,
        unknown
      >);
    } else {
      doc.text(text, x, cursor + 4.5);
    }
    x += col.w;
  }

  return cursor + rowH + 1;
}

function drawTotals(
  doc: JsPDFInstance,
  yIn: number,
  totals: ManualInvoiceTotals,
  currency: string,
): number {
  const boxW = 80;
  const boxX = MARGIN + CONTENT_W - boxW;
  let y = ensureSpace(doc, yIn + 4, 60);

  doc.setDrawColor(180, 180, 180);
  doc.setFontSize(10);

  function row(label: string, value: string, bold = false): void {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(label, boxX, y);
    doc.text(value, boxX + boxW, y, { align: 'right' } as Record<string, unknown>);
    y += 5;
  }

  row(
    uiCopy.manualBilling.pdfTotalsSubtotalRates,
    formatMoneyCents(totals.subtotal_rates_cents, currency),
  );
  row(
    uiCopy.manualBilling.pdfTotalsSubtotalExpenses,
    formatMoneyCents(totals.subtotal_expenses_cents, currency),
  );
  if (totals.service_charge_cents > 0) {
    row(
      uiCopy.manualBilling.pdfTotalsServiceCharge,
      formatMoneyCents(totals.service_charge_cents, currency),
    );
  }
  for (const v of totals.vat_breakdown) {
    if (v.tax_cents === 0 && (v.rate_percent == null || v.rate_percent === 0)) {
      row(
        uiCopy.manualBilling.pdfTotalsVat(v.rate_percent, v.treatment),
        formatMoneyCents(0, currency),
      );
    } else {
      row(
        uiCopy.manualBilling.pdfTotalsVat(v.rate_percent, v.treatment),
        formatMoneyCents(v.tax_cents, currency),
      );
    }
  }
  if (totals.tax_total_cents > 0) {
    row(uiCopy.manualBilling.pdfTotalsTaxTotal, formatMoneyCents(totals.tax_total_cents, currency));
  }
  doc.setDrawColor(60, 60, 60);
  doc.line(boxX, y, boxX + boxW, y);
  y += 4;
  row(
    uiCopy.manualBilling.pdfTotalsGrandTotal,
    formatMoneyCents(totals.grand_total_cents, currency),
    true,
  );
  return y + 2;
}

function drawNotes(doc: JsPDFInstance, yIn: number, input: ManualInvoicePdfInput): number {
  const { invoice, sender } = input;
  let y = yIn + 2;

  function block(label: string, value: string | null | undefined): void {
    const text = safeText(value);
    if (!text) return;
    y = ensureSpace(doc, y, 12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(label.toUpperCase(), MARGIN, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(17, 17, 17);
    const wrapped = doc.splitTextToSize(text, CONTENT_W);
    for (const w of wrapped) {
      y = ensureSpace(doc, y, 5);
      doc.text(w, MARGIN, y);
      y += 4;
    }
    y += 2;
  }

  block(uiCopy.manualBilling.pdfTaxNoteLabel, invoice.tax_note);
  block(uiCopy.manualBilling.pdfNotesLabel, invoice.invoice_notes);

  // Bank details: prefer invoice payment_instructions; otherwise derive from sender.
  const senderInfo = partyLines(sender);
  const bankBlock = invoice.payment_instructions
    ? safeText(invoice.payment_instructions)
    : senderInfo.bank.length > 0
      ? senderInfo.bank.join('\n')
      : '';
  block(uiCopy.manualBilling.pdfPaymentInstructionsLabel, bankBlock);

  block('', invoice.footer_notes ?? null);
  return y;
}

function drawFooter(doc: JsPDFInstance, sender: PartyLike | null): void {
  const total =
    typeof doc.internal.getNumberOfPages === 'function'
      ? doc.internal.getNumberOfPages()
      : (doc.internal.pages?.length ?? 1) - 1;
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(150, 150, 150);
    const senderInfo = partyLines(sender);
    const left = senderInfo.legalName || uiCopy.manualBilling.pdfFooterFallback;
    doc.text(left, MARGIN, PAGE_H - 8);
    doc.text(uiCopy.manualBilling.pdfPageLabel(p, total), PAGE_W - MARGIN, PAGE_H - 8, {
      align: 'right',
    } as Record<string, unknown>);
    doc.setTextColor(17, 17, 17);
  }
}

// ── Public entry point ────────────────────────────────────────────────────

export async function buildManualInvoicePdf(input: ManualInvoicePdfInput): Promise<Blob> {
  const jspdfModule = await import('jspdf');
  const JsPDFClass = (jspdfModule as { jsPDF: new (opts: Record<string, unknown>) => unknown })
    .jsPDF;
  const doc = new JsPDFClass({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  }) as JsPDFInstance;

  const number = safeText(input.invoice.invoice_number) || (input.isDraft ? 'DRAFT' : 'invoice');
  doc.setProperties({ title: uiCopy.manualBilling.pdfTitle(number) });

  if (input.isDraft) drawDraftWatermark(doc);

  let y = drawHeader(doc, input);

  // Line items
  const cols = lineColumns();
  y = drawTableHeader(doc, y, cols);

  if (input.lines.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    doc.text('No line items.', MARGIN + ROW_PAD, y + 6);
    doc.setTextColor(17, 17, 17);
    y += 12;
  } else {
    for (const line of input.lines) {
      y = drawTableRow(doc, y, cols, line, input.invoice.currency);
    }
  }

  y = drawTotals(doc, y, input.totals, input.invoice.currency);
  drawNotes(doc, y, input);
  drawFooter(doc, input.sender);

  return doc.output('blob') as Blob;
}

export function downloadManualInvoicePdf(blob: Blob, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function manualInvoicePdfFilename(input: {
  invoiceNumber: string | null;
  recipientName?: string | null;
  isDraft?: boolean;
}): string {
  const number = safeText(input.invoiceNumber) || 'draft';
  const recipient = safeText(input.recipientName ?? '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 40);
  const draft = input.isDraft ? '-draft' : '';
  return `Invoice-${number}${recipient ? `-${recipient}` : ''}${draft}.pdf`;
}
