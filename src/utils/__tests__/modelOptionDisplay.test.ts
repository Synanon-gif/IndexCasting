import type { OptionRequest } from '../../store/optionRequests';
import {
  primaryCounterpartyLabelForModel,
  primaryCounterpartyLabelForModelFromDbRow,
  secondarySubtitleForModel,
} from '../modelOptionDisplay';

function base(over: Partial<OptionRequest> = {}): OptionRequest {
  return {
    id: 'or-1',
    clientName: 'Client',
    modelName: 'Model',
    modelId: 'm1',
    date: '2026-04-20',
    createdAt: 1,
    threadId: 't1',
    status: 'in_negotiation',
    modelApproval: 'pending',
    ...over,
  };
}

describe('primaryCounterpartyLabelForModel', () => {
  it('prefers client org over agency for client-driven requests', () => {
    expect(
      primaryCounterpartyLabelForModel(
        base({
          isAgencyOnly: false,
          clientOrganizationName: 'Acme Co',
          agencyOrganizationName: 'Big Agency',
        }),
      ),
    ).toBe('Acme Co');
  });

  it('uses agency org for agency-only', () => {
    expect(
      primaryCounterpartyLabelForModel(
        base({
          isAgencyOnly: true,
          agencyOrganizationName: 'Studio X',
          clientOrganizationName: null as unknown as undefined,
        }),
      ),
    ).toBe('Studio X');
  });

  it('prefers client org from DB row over generic client_name', () => {
    expect(
      primaryCounterpartyLabelForModelFromDbRow({
        is_agency_only: false,
        client_name: 'Client',
        client_organization_name: 'CLIENT 1',
        agency_organization_name: 'Poetry Of People',
      }),
    ).toBe('CLIENT 1');
  });
});

describe('secondarySubtitleForModel', () => {
  it('includes date and truncated job text', () => {
    const long = 'x'.repeat(200);
    const sub = secondarySubtitleForModel(base({ date: '2026-01-01', jobDescription: long }));
    expect(sub.startsWith('2026-01-01 · ')).toBe(true);
    expect(sub.endsWith('…')).toBe(true);
  });
});
