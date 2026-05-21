import {
  assertInvoiceRecipientLabelNotUuid,
  fetchInvoiceRecipientOrganizationName,
  isUuidString,
  recipientNameFromBillingSnapshot,
  resolveInvoiceRecipientDisplayLabel,
} from '../invoiceRecipientDisplay';
import { uiCopy } from '../../constants/uiCopy';

jest.mock('../../services/b2bOrgChatSupabase', () => ({
  getOrganizationName: jest.fn(),
}));

jest.mock('../../services/clientOrganizationsDirectorySupabase', () => ({
  listClientOrganizationsForAgencyDirectory: jest.fn(),
}));

jest.mock('../../services/agencyOrganizationsDirectorySupabase', () => ({
  listAgencyOrganizationsForAgencyDirectory: jest.fn(),
}));

import { getOrganizationName } from '../../services/b2bOrgChatSupabase';
import { listClientOrganizationsForAgencyDirectory } from '../../services/clientOrganizationsDirectorySupabase';

const CLIENT_ORG_ID = '6451a08c-ffaf-4971-af8b-101a7502345b';
const AGENCY_ORG_ID = 'a1111111-1111-4111-8111-111111111111';

describe('invoiceRecipientDisplay', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('isUuidString', () => {
    it('detects canonical UUIDs', () => {
      expect(isUuidString(CLIENT_ORG_ID)).toBe(true);
      expect(isUuidString('Client 3')).toBe(false);
    });
  });

  describe('recipientNameFromBillingSnapshot', () => {
    it('prefers billing_name from snapshot', () => {
      expect(
        recipientNameFromBillingSnapshot({
          billing_name: 'Client GmbH',
          name: 'Other',
        }),
      ).toBe('Client GmbH');
    });

    it('ignores UUID-like snapshot values', () => {
      expect(recipientNameFromBillingSnapshot({ billing_name: CLIENT_ORG_ID })).toBeNull();
    });
  });

  describe('resolveInvoiceRecipientDisplayLabel', () => {
    it('auto-created draft: shows client org name, not UUID', () => {
      const label = resolveInvoiceRecipientDisplayLabel({
        recipientOrganizationId: CLIENT_ORG_ID,
        recipientBillingSnapshot: null,
        resolvedOrganizationName: 'Client 3',
      });
      expect(label).toBe('Client 3');
      expect(isUuidString(label)).toBe(false);
      assertInvoiceRecipientLabelNotUuid(label);
    });

    it('uses snapshot billing_name when present', () => {
      const label = resolveInvoiceRecipientDisplayLabel({
        recipientOrganizationId: CLIENT_ORG_ID,
        recipientBillingSnapshot: { billing_name: 'Snapshot Client Ltd' },
        resolvedOrganizationName: 'Client 3',
      });
      expect(label).toBe('Snapshot Client Ltd');
    });

    it('falls back to unknownClient when only UUID is available', () => {
      const label = resolveInvoiceRecipientDisplayLabel({
        recipientOrganizationId: CLIENT_ORG_ID,
        recipientBillingSnapshot: null,
        resolvedOrganizationName: null,
      });
      expect(label).toBe(uiCopy.common.unknownClient);
      expect(label).not.toBe(CLIENT_ORG_ID);
    });

    it('recipient_organization_id remains internal — label never equals stored id when unresolved', () => {
      const label = resolveInvoiceRecipientDisplayLabel({
        recipientOrganizationId: CLIENT_ORG_ID,
      });
      expect(label).not.toBe(CLIENT_ORG_ID);
    });
  });

  describe('fetchInvoiceRecipientOrganizationName', () => {
    it('resolves client org via directory when direct org read misses', async () => {
      (getOrganizationName as jest.Mock).mockResolvedValue(null);
      (listClientOrganizationsForAgencyDirectory as jest.Mock).mockResolvedValue([
        { id: CLIENT_ORG_ID, name: 'Poetry of People Client', organization_type: 'client' },
      ]);

      const name = await fetchInvoiceRecipientOrganizationName(
        AGENCY_ORG_ID,
        CLIENT_ORG_ID,
        'agency_to_client',
      );

      expect(name).toBe('Poetry of People Client');
      expect(listClientOrganizationsForAgencyDirectory).toHaveBeenCalledWith(AGENCY_ORG_ID, '');
    });

    it('prefers direct organization name when available', async () => {
      (getOrganizationName as jest.Mock).mockResolvedValue('Client 3');
      const name = await fetchInvoiceRecipientOrganizationName(
        AGENCY_ORG_ID,
        CLIENT_ORG_ID,
        'agency_to_client',
      );
      expect(name).toBe('Client 3');
      expect(listClientOrganizationsForAgencyDirectory).not.toHaveBeenCalled();
    });
  });

  describe('UUID leak assertion', () => {
    it('throws when label is a UUID', () => {
      expect(() => assertInvoiceRecipientLabelNotUuid(CLIENT_ORG_ID)).toThrow(/UUID/);
    });

    it('passes for human-readable labels', () => {
      expect(() => assertInvoiceRecipientLabelNotUuid('Client 3')).not.toThrow();
    });
  });
});
