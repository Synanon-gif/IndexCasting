import { isSystemInvoiceDraftEditableByAgency } from '../invoiceOverviewDraftActions';
import type { InvoiceOverviewRow } from '../../types/invoiceOverviewTypes';

const baseRow = (
  overrides: Partial<Pick<InvoiceOverviewRow, 'sourceType' | 'sourceStatus' | 'direction'>>,
): Pick<InvoiceOverviewRow, 'sourceType' | 'sourceStatus' | 'direction'> => ({
  sourceType: 'system',
  sourceStatus: 'draft',
  direction: 'agency_to_client',
  ...overrides,
});

describe('isSystemInvoiceDraftEditableByAgency', () => {
  it('allows agency_to_client draft for operational agency member', () => {
    expect(isSystemInvoiceDraftEditableByAgency(baseRow({}), 'agency', true)).toBe(true);
  });

  it('rejects client viewer', () => {
    expect(isSystemInvoiceDraftEditableByAgency(baseRow({}), 'client', true)).toBe(false);
  });

  it('rejects non-draft system invoice', () => {
    expect(
      isSystemInvoiceDraftEditableByAgency(baseRow({ sourceStatus: 'sent' }), 'agency', true),
    ).toBe(false);
  });

  it('rejects manual invoice drafts in overview', () => {
    expect(
      isSystemInvoiceDraftEditableByAgency(
        baseRow({ sourceType: 'manual', sourceStatus: 'draft' }),
        'agency',
        true,
      ),
    ).toBe(false);
  });

  it('rejects platform_to_agency incoming draft', () => {
    expect(
      isSystemInvoiceDraftEditableByAgency(
        baseRow({ direction: 'platform_to_agency' }),
        'agency',
        true,
      ),
    ).toBe(false);
  });

  it('rejects when not operational member', () => {
    expect(isSystemInvoiceDraftEditableByAgency(baseRow({}), 'agency', false)).toBe(false);
  });
});
