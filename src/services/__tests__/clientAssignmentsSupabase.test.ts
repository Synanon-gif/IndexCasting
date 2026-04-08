jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'agency-user-1' } } }),
    },
  },
}));

jest.mock('../organizationsInvitationsSupabase', () => ({
  listOrganizationMembers: jest.fn(),
}));

import { supabase } from '../../../lib/supabase';
import { listOrganizationMembers } from '../organizationsInvitationsSupabase';
import {
  getClientAssignmentMapForAgency,
  upsertClientAssignmentFlag,
} from '../clientAssignmentsSupabase';

const from = supabase.from as jest.Mock;
const mockedListMembers = listOrganizationMembers as jest.Mock;

describe('clientAssignmentsSupabase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds assignment map keyed by client organization id', async () => {
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: jest.fn().mockResolvedValue({
            data: [
              {
                id: 'caf-1',
                agency_organization_id: 'agency-org-1',
                client_organization_id: 'client-org-1',
                label: 'PRIORITY',
                color: 'blue',
                assigned_member_user_id: 'member-1',
                is_archived: false,
                created_by: 'agency-user-1',
                created_at: '2026-04-08T10:00:00Z',
                updated_at: '2026-04-08T10:00:00Z',
              },
            ],
            error: null,
          }),
        }),
      }),
    });
    mockedListMembers.mockResolvedValue([
      {
        user_id: 'member-1',
        display_name: 'Ruben',
        email: 'ruben@example.com',
      },
    ]);

    const map = await getClientAssignmentMapForAgency('agency-org-1');

    expect(map['client-org-1']).toBeTruthy();
    expect(map['client-org-1'].assignedMemberName).toBe('Ruben');
    expect(map['client-org-1'].label).toBe('PRIORITY');
  });

  it('upserts assignment and returns mapped result', async () => {
    from.mockReturnValue({
      upsert: () => ({
        select: () => ({
          maybeSingle: jest.fn().mockResolvedValue({
            data: {
              id: 'caf-2',
              agency_organization_id: 'agency-org-1',
              client_organization_id: 'client-org-2',
              label: 'BLUE',
              color: 'blue',
              assigned_member_user_id: 'member-2',
              is_archived: false,
              created_by: 'agency-user-1',
              created_at: '2026-04-08T12:00:00Z',
              updated_at: '2026-04-08T12:00:00Z',
            },
            error: null,
          }),
        }),
      }),
    });
    mockedListMembers.mockResolvedValue([
      {
        user_id: 'member-2',
        display_name: null,
        email: 'booker@example.com',
      },
    ]);

    const saved = await upsertClientAssignmentFlag({
      agencyOrganizationId: 'agency-org-1',
      clientOrganizationId: 'client-org-2',
      label: ' BLUE ',
      color: 'blue',
      assignedMemberUserId: 'member-2',
    });

    expect(saved).not.toBeNull();
    expect(saved?.label).toBe('BLUE');
    expect(saved?.assignedMemberName).toBe('booker@example.com');
  });

  it('sanitizes label input and preserves unassigned when member is null', async () => {
    from.mockReturnValue({
      upsert: () => ({
        select: () => ({
          maybeSingle: jest.fn().mockResolvedValue({
            data: {
              id: 'caf-3',
              agency_organization_id: 'agency-org-1',
              client_organization_id: 'client-org-3',
              label: 'HIGH_TOUCH',
              color: 'purple',
              assigned_member_user_id: null,
              is_archived: false,
              created_by: 'agency-user-1',
              created_at: '2026-04-08T12:00:00Z',
              updated_at: '2026-04-08T12:00:00Z',
            },
            error: null,
          }),
        }),
      }),
    });
    mockedListMembers.mockResolvedValue([]);

    const saved = await upsertClientAssignmentFlag({
      agencyOrganizationId: 'agency-org-1',
      clientOrganizationId: 'client-org-3',
      label: '  high touch  ',
      color: 'purple',
      assignedMemberUserId: null,
    });

    expect(saved).not.toBeNull();
    expect(saved?.label).toBe('HIGH_TOUCH');
    expect(saved?.assignedMemberUserId).toBeNull();
  });
});
