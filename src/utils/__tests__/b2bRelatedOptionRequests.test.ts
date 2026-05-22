import {
  filterRelatedOptionRequestsForB2BConversation,
  relatedRequestCardTitle,
} from '../b2bRelatedOptionRequests';

const CLIENT_ORG = 'client-org-1';
const AGENCY_ORG = 'agency-org-1';

describe('filterRelatedOptionRequestsForB2BConversation', () => {
  it('returns two requests for same org pair with different model ids', () => {
    const rows = filterRelatedOptionRequestsForB2BConversation(
      [
        {
          id: 'req-a',
          modelName: 'Ruben E',
          date: '2026-08-01',
          status: 'in_negotiation',
          finalStatus: 'option_confirmed',
          requestType: 'option',
          clientOrganizationId: CLIENT_ORG,
          agencyOrganizationId: AGENCY_ORG,
        },
        {
          id: 'req-b',
          modelName: 'Rémi Lovisolo',
          date: '2026-08-02',
          status: 'confirmed',
          finalStatus: 'job_confirmed',
          requestType: 'option',
          clientOrganizationId: CLIENT_ORG,
          agencyOrganizationId: AGENCY_ORG,
        },
      ],
      CLIENT_ORG,
      AGENCY_ORG,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual(['req-a', 'req-b']);
  });

  it('includes job_confirmed and pending option rows', () => {
    const rows = filterRelatedOptionRequestsForB2BConversation(
      [
        {
          id: 'req-open',
          modelName: 'Model A',
          date: '2026-08-01',
          status: 'in_negotiation',
          finalStatus: 'option_pending',
          clientOrganizationId: CLIENT_ORG,
          agencyOrganizationId: AGENCY_ORG,
        },
        {
          id: 'req-job',
          modelName: 'Model B',
          date: '2026-08-01',
          status: 'confirmed',
          finalStatus: 'job_confirmed',
          clientOrganizationId: CLIENT_ORG,
          agencyOrganizationId: AGENCY_ORG,
        },
      ],
      CLIENT_ORG,
      AGENCY_ORG,
    );
    expect(rows).toHaveLength(2);
  });

  it('dedupes by option_request_id not conversation', () => {
    const rows = filterRelatedOptionRequestsForB2BConversation(
      [
        {
          id: 'req-a',
          modelName: 'Model A',
          date: '2026-08-01',
          status: 'in_negotiation',
          clientOrganizationId: CLIENT_ORG,
          agencyOrganizationId: AGENCY_ORG,
        },
        {
          id: 'req-a',
          modelName: 'Model A duplicate',
          date: '2026-08-01',
          status: 'in_negotiation',
          clientOrganizationId: CLIENT_ORG,
          agencyOrganizationId: AGENCY_ORG,
        },
      ],
      CLIENT_ORG,
      AGENCY_ORG,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('req-a');
  });

  it('sorts by date desc then id for stable mobile/desktop strip order', () => {
    const rows = filterRelatedOptionRequestsForB2BConversation(
      [
        {
          id: 'req-older',
          modelName: 'Model A',
          date: '2026-08-01',
          status: 'in_negotiation',
          clientOrganizationId: CLIENT_ORG,
          agencyOrganizationId: AGENCY_ORG,
        },
        {
          id: 'req-newer',
          modelName: 'Model B',
          date: '2026-08-15',
          status: 'confirmed',
          finalStatus: 'job_confirmed',
          clientOrganizationId: CLIENT_ORG,
          agencyOrganizationId: AGENCY_ORG,
        },
      ],
      CLIENT_ORG,
      AGENCY_ORG,
    );
    expect(rows.map((r) => r.id)).toEqual(['req-newer', 'req-older']);
  });

  it('excludes cross-org and rejected requests', () => {
    const rows = filterRelatedOptionRequestsForB2BConversation(
      [
        {
          id: 'req-other-client',
          modelName: 'X',
          date: '2026-08-01',
          status: 'in_negotiation',
          clientOrganizationId: 'other-client',
          agencyOrganizationId: AGENCY_ORG,
        },
        {
          id: 'req-rejected',
          modelName: 'Y',
          date: '2026-08-01',
          status: 'rejected',
          clientOrganizationId: CLIENT_ORG,
          agencyOrganizationId: AGENCY_ORG,
        },
        {
          id: 'req-ok',
          modelName: 'Z',
          date: '2026-08-01',
          status: 'in_negotiation',
          clientOrganizationId: CLIENT_ORG,
          agencyOrganizationId: AGENCY_ORG,
        },
      ],
      CLIENT_ORG,
      AGENCY_ORG,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('req-ok');
  });
});

describe('relatedRequestCardTitle', () => {
  it('labels job_confirmed as job', () => {
    expect(relatedRequestCardTitle('option', 'job_confirmed')).toBe('job');
  });
});
