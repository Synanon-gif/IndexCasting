import {
  buildB2bOrgChatTimeline,
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

  it('sorts filter results by date desc then id (newest first for summaries)', () => {
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

  it('excludes agency-only requests from B2B org-chat related list', () => {
    const rows = filterRelatedOptionRequestsForB2BConversation(
      [
        {
          id: 'req-agency-only',
          modelName: 'Internal',
          date: '2026-08-01',
          status: 'in_negotiation',
          clientOrganizationId: CLIENT_ORG,
          agencyOrganizationId: AGENCY_ORG,
          isAgencyOnly: true,
        },
        {
          id: 'req-client',
          modelName: 'Client path',
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
    expect(rows[0]?.id).toBe('req-client');
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

describe('buildB2bOrgChatTimeline', () => {
  it('merges orphan related requests chronologically with messages', () => {
    const timeline = buildB2bOrgChatTimeline(
      [
        {
          id: 'msg-1',
          created_at: '2026-05-21T10:00:00.000Z',
          message_type: 'package',
        },
        {
          id: 'msg-2',
          created_at: '2026-05-23T09:00:00.000Z',
          message_type: 'text',
        },
      ],
      [
        {
          id: 'req-a',
          modelName: 'Rémi Lovisolo',
          date: '2026-05-22',
          status: 'in_negotiation',
        },
      ],
    );
    expect(timeline.map((e) => (e.kind === 'message' ? e.message.id : e.request.id))).toEqual([
      'msg-1',
      'req-a',
      'msg-2',
    ]);
  });

  it('Poetry-of-People style: one booking card in thread + one orphan inline by date', () => {
    const timeline = buildB2bOrgChatTimeline(
      [
        {
          id: 'msg-package',
          created_at: '2026-05-20T14:00:00.000Z',
          message_type: 'package',
        },
        {
          id: 'msg-booking-ruben',
          created_at: '2026-05-21T09:00:00.000Z',
          message_type: 'booking',
          metadata: { option_request_id: 'req-ruben' },
        },
        {
          id: 'msg-text-later',
          created_at: '2026-05-23T11:00:00.000Z',
          message_type: 'text',
        },
      ],
      [
        {
          id: 'req-ruben',
          modelName: 'Ruben E',
          date: '2026-05-21',
          status: 'in_negotiation',
        },
        {
          id: 'req-remi',
          modelName: 'Rémi Lovisolo',
          date: '2026-05-22',
          status: 'in_negotiation',
        },
      ],
    );
    expect(
      timeline.map((e) => (e.kind === 'message' ? e.message.id : `related:${e.request.id}`)),
    ).toEqual(['msg-package', 'msg-booking-ruben', 'related:req-remi', 'msg-text-later']);
  });

  it('sorts timeline ascending by timestamp (messages) and request date at noon UTC', () => {
    const timeline = buildB2bOrgChatTimeline(
      [
        {
          id: 'msg-late',
          created_at: '2026-05-25T08:00:00.000Z',
          message_type: 'text',
        },
        {
          id: 'msg-early',
          created_at: '2026-05-20T08:00:00.000Z',
          message_type: 'text',
        },
      ],
      [
        { id: 'req-mid', modelName: 'M', date: '2026-05-22', status: 'in_negotiation' },
        { id: 'req-old', modelName: 'O', date: '2026-05-19', status: 'in_negotiation' },
      ],
    );
    expect(timeline.map((e) => (e.kind === 'message' ? e.message.id : e.request.id))).toEqual([
      'req-old',
      'msg-early',
      'req-mid',
      'msg-late',
    ]);
  });

  it('returns messages only when every related request has a booking card', () => {
    const timeline = buildB2bOrgChatTimeline(
      [
        {
          id: 'msg-a',
          created_at: '2026-05-21T10:00:00.000Z',
          message_type: 'booking',
          metadata: { option_request_id: 'req-a' },
        },
        {
          id: 'msg-b',
          created_at: '2026-05-22T10:00:00.000Z',
          message_type: 'booking',
          metadata: { option_request_id: '  req-b  ' },
        },
      ],
      [
        { id: 'req-a', modelName: 'A', date: '2026-05-21', status: 'in_negotiation' },
        { id: 'req-b', modelName: 'B', date: '2026-05-22', status: 'in_negotiation' },
      ],
    );
    expect(timeline).toHaveLength(2);
    expect(timeline.every((e) => e.kind === 'message')).toBe(true);
  });

  it('returns orphan cards only when there are no messages', () => {
    const timeline = buildB2bOrgChatTimeline(
      [],
      [
        { id: 'req-newer', modelName: 'N', date: '2026-05-22', status: 'in_negotiation' },
        { id: 'req-older', modelName: 'O', date: '2026-05-20', status: 'in_negotiation' },
      ],
    );
    expect(timeline.map((e) => (e.kind === 'related_request' ? e.request.id : null))).toEqual([
      'req-older',
      'req-newer',
    ]);
  });

  it('skips related requests that already have a booking card message', () => {
    const timeline = buildB2bOrgChatTimeline(
      [
        {
          id: 'msg-booking',
          created_at: '2026-05-21T10:00:00.000Z',
          message_type: 'booking',
          metadata: { option_request_id: 'req-a' },
        },
      ],
      [
        {
          id: 'req-a',
          modelName: 'Ruben E',
          date: '2026-05-21',
          status: 'in_negotiation',
        },
        {
          id: 'req-b',
          modelName: 'Rémi Lovisolo',
          date: '2026-05-22',
          status: 'in_negotiation',
        },
      ],
    );
    expect(timeline).toHaveLength(2);
    expect(timeline[0]?.kind).toBe('message');
    expect(timeline[1]?.kind).toBe('related_request');
    if (timeline[1]?.kind === 'related_request') {
      expect(timeline[1].request.id).toBe('req-b');
    }
  });
});

describe('relatedRequestCardTitle', () => {
  it('labels job_confirmed as job', () => {
    expect(relatedRequestCardTitle('option', 'job_confirmed')).toBe('job');
  });
});
