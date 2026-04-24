/**
 * Normalise manual invoice numbers for storage and collision checks.
 * Trims, uppercases ASCII, collapses internal whitespace to single spaces.
 */
export function normalizeManualInvoiceNumber(input: string | null | undefined): string {
  if (input == null) return '';
  return input.trim().replace(/\s+/g, ' ').toUpperCase();
}
