import { normalizeManualInvoiceNumber } from '../manualInvoiceNumber';

describe('normalizeManualInvoiceNumber', () => {
  it('trims, uppercases, collapses spaces', () => {
    expect(normalizeManualInvoiceNumber('  inv-001  ')).toBe('INV-001');
    expect(normalizeManualInvoiceNumber('inv  -  001')).toBe('INV - 001');
    expect(normalizeManualInvoiceNumber('a  b   c')).toBe('A B C');
  });

  it('handles nullish', () => {
    expect(normalizeManualInvoiceNumber(null)).toBe('');
    expect(normalizeManualInvoiceNumber(undefined)).toBe('');
  });
});
