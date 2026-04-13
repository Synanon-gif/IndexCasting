import {
  deriveApprovalAttention,
  approvalAttentionVisibleForRole,
  smartAttentionVisibleForRole,
  clientMayConfirmJobFromSignals,
  type AttentionSignalInput,
} from '../optionRequestAttention';
import { attentionHeaderLabelFromSignals } from '../negotiationAttentionLabels';
import { extractCounterparties } from '../threadFilters';
import { shouldShowSystemMessageForViewer } from '../../components/optionNegotiation/filterSystemMessagesForViewer';
import { uiCopy } from '../../constants/uiCopy';

describe('agency-only attention — job finalization signals to agency, not client', () => {
  const agencyOnlyJobReady: AttentionSignalInput = {
    status: 'confirmed',
    finalStatus: 'option_confirmed',
    clientPriceStatus: 'accepted',
    proposedPrice: null,
    modelApproval: 'approved',
    modelAccountLinked: false,
    isAgencyOnly: true,
  };

  it('D2 = waiting_for_agency_to_finalize_job (not waiting_for_client)', () => {
    expect(deriveApprovalAttention(agencyOnlyJobReady)).toBe('waiting_for_agency_to_finalize_job');
  });

  it('agency sees "Action required"', () => {
    expect(attentionHeaderLabelFromSignals(agencyOnlyJobReady, 'agency')).toBe('Action required');
  });

  it('client sees null or waiting label (no client action in agency-only flow)', () => {
    const label = attentionHeaderLabelFromSignals(agencyOnlyJobReady, 'client');
    expect(label).not.toBe('Action required');
  });

  it('approvalAttentionVisibleForRole: visible for agency, not client', () => {
    expect(approvalAttentionVisibleForRole('waiting_for_agency_to_finalize_job', 'agency')).toBe(true);
    expect(approvalAttentionVisibleForRole('waiting_for_agency_to_finalize_job', 'client')).toBe(false);
    expect(approvalAttentionVisibleForRole('waiting_for_agency_to_finalize_job', 'model')).toBe(false);
  });

  it('clientMayConfirmJobFromSignals returns false for agency-only', () => {
    expect(clientMayConfirmJobFromSignals(agencyOnlyJobReady)).toBe(false);
  });

  it('smartAttentionVisibleForRole with isAgencyOnly shows for agency, not client', () => {
    expect(smartAttentionVisibleForRole('job_confirmation_pending', 'agency', true)).toBe(true);
    expect(smartAttentionVisibleForRole('job_confirmation_pending', 'client', true)).toBe(false);
  });
});

describe('agency-only attention — in_negotiation status', () => {
  const agencyOnlyInNego: AttentionSignalInput = {
    status: 'in_negotiation',
    finalStatus: 'option_confirmed',
    clientPriceStatus: 'accepted',
    proposedPrice: null,
    modelApproval: 'approved',
    modelAccountLinked: false,
    isAgencyOnly: true,
  };

  it('D2 = waiting_for_agency_to_finalize_job', () => {
    expect(deriveApprovalAttention(agencyOnlyInNego)).toBe('waiting_for_agency_to_finalize_job');
  });
});

describe('non-agency-only requests are unaffected by isAgencyOnly=false', () => {
  const normalJobReady: AttentionSignalInput = {
    status: 'confirmed',
    finalStatus: 'option_confirmed',
    clientPriceStatus: 'accepted',
    proposedPrice: 100,
    modelApproval: 'approved',
    modelAccountLinked: true,
    isAgencyOnly: false,
  };

  it('D2 = waiting_for_client_to_finalize_job (default client flow)', () => {
    expect(deriveApprovalAttention(normalJobReady)).toBe('waiting_for_client_to_finalize_job');
  });

  it('client sees "Action required"', () => {
    expect(attentionHeaderLabelFromSignals(normalJobReady, 'client')).toBe('Action required');
  });

  it('agency sees null (client must confirm job)', () => {
    expect(attentionHeaderLabelFromSignals(normalJobReady, 'agency')).toBeNull();
  });
});

describe('counterparty filter — agency-only grouped under "Internal events"', () => {
  const requests = [
    {
      threadId: '1', status: 'in_negotiation', clientOrganizationId: 'org-1',
      clientOrganizationName: 'ACME Corp', clientName: 'John', isAgencyOnly: false,
    },
    {
      threadId: '2', status: 'in_negotiation', clientOrganizationId: undefined,
      clientOrganizationName: undefined, clientName: 'Agency Event', isAgencyOnly: true,
    },
    {
      threadId: '3', status: 'in_negotiation', clientOrganizationId: undefined,
      clientOrganizationName: undefined, clientName: 'Photoshoot', isAgencyOnly: true,
    },
  ] as any;

  it('extracts "Internal events" bucket for agency-only requests', () => {
    const cps = extractCounterparties(requests, 'agency');
    expect(cps.some((c) => c.id === '__agency_internal__' && c.label === 'Internal events')).toBe(true);
  });

  it('does not create separate entries for each agency-only title', () => {
    const cps = extractCounterparties(requests, 'agency');
    const internalEntries = cps.filter((c) => c.id === '__agency_internal__');
    expect(internalEntries).toHaveLength(1);
  });

  it('still lists normal counterparties', () => {
    const cps = extractCounterparties(requests, 'agency');
    expect(cps.some((c) => c.label === 'ACME Corp')).toBe(true);
  });
});

describe('system message filter — jobConfirmedByAgency visible to all', () => {
  const agencyJobMsg = { from: 'system', text: uiCopy.systemMessages.jobConfirmedByAgency } as any;

  it('visible to agency', () => {
    expect(shouldShowSystemMessageForViewer(agencyJobMsg, 'agency')).toBe(true);
  });

  it('visible to client', () => {
    expect(shouldShowSystemMessageForViewer(agencyJobMsg, 'client')).toBe(true);
  });

  it('visible to model', () => {
    expect(shouldShowSystemMessageForViewer(agencyJobMsg, 'model')).toBe(true);
  });
});
