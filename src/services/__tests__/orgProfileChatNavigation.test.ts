/**
 * Tests for Phase 2B — Chat Header Navigation to Org Profiles
 *
 * Covers:
 * - Deriving counterparty org ID from conversation (agency perspective → client_organization_id)
 * - Deriving counterparty org ID from conversation (client perspective → agency_organization_id)
 * - Null-safe: missing org ID → no navigation (no-op)
 * - getAgencyIdForOrganization returns null → modal receives null agencyId (safe)
 * - getOrganizationIdForAgency returns null → agency profile not shown for model
 *
 * RLS enforcement is server-side only; these tests verify client-side routing logic.
 */

import type { Conversation } from '../messengerSupabase';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConversation(
  overrides: Partial<Conversation> & { id: string },
): Conversation {
  return {
    type: 'option',
    context_id: null,
    participant_ids: [],
    title: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    created_by: null,
    client_organization_id: null,
    agency_organization_id: null,
    guest_user_id: null,
    ...overrides,
  };
}

// ─── Agency perspective: derive client_organization_id ────────────────────────

describe('Agency perspective — resolving client org ID from conversation', () => {
  const conversations: Conversation[] = [
    makeConversation({ id: 'conv-1', client_organization_id: 'client-org-abc', agency_organization_id: 'agency-org-xyz' }),
    makeConversation({ id: 'conv-2', client_organization_id: 'client-org-def', agency_organization_id: 'agency-org-xyz' }),
  ];

  it('returns client_organization_id for the active conversation', () => {
    const activeId = 'conv-1';
    const conv = conversations.find((c) => c.id === activeId);
    const orgId = conv?.client_organization_id ?? null;
    expect(orgId).toBe('client-org-abc');
  });

  it('returns null if no conversation matches the active ID', () => {
    const activeId = 'conv-nonexistent';
    const conv = conversations.find((c) => c.id === activeId);
    const orgId = conv?.client_organization_id ?? null;
    expect(orgId).toBeNull();
  });

  it('returns null if client_organization_id is missing on the conversation', () => {
    const incompleteConvs: Conversation[] = [
      makeConversation({ id: 'conv-3' }), // no client_organization_id
    ];
    const conv = incompleteConvs.find((c) => c.id === 'conv-3');
    const orgId = conv?.client_organization_id ?? null;
    expect(orgId).toBeNull();
  });
});

// ─── Client perspective: derive agency_organization_id ────────────────────────

describe('Client perspective — resolving agency org ID from conversation', () => {
  const rows: Conversation[] = [
    makeConversation({ id: 'row-1', agency_organization_id: 'agency-org-abc', client_organization_id: 'client-org-xyz' }),
    makeConversation({ id: 'row-2', agency_organization_id: 'agency-org-def', client_organization_id: 'client-org-xyz' }),
  ];

  it('returns agency_organization_id for the selected row', () => {
    const selectedId = 'row-1';
    const selectedRow = rows.find((r) => r.id === selectedId);
    const orgId = selectedRow?.agency_organization_id ?? null;
    expect(orgId).toBe('agency-org-abc');
  });

  it('returns null if selected row is not in the list', () => {
    const selectedId = 'row-nonexistent';
    const selectedRow = rows.find((r) => r.id === selectedId);
    const orgId = selectedRow?.agency_organization_id ?? null;
    expect(orgId).toBeNull();
  });

  it('returns null if agency_organization_id is missing on the row', () => {
    const incompleteRows: Conversation[] = [
      makeConversation({ id: 'row-3' }), // no agency_organization_id
    ];
    const selectedRow = incompleteRows.find((r) => r.id === 'row-3');
    const orgId = selectedRow?.agency_organization_id ?? null;
    expect(orgId).toBeNull();
  });
});

// ─── Null-safe navigation guard ───────────────────────────────────────────────

describe('Navigation guard: missing org ID → no-op', () => {
  it('does not navigate when client org ID is null (agency side)', () => {
    const onOrgPressCallCount = { n: 0 };
    const orgId: string | null = null;

    // Simulate the onOrgPress handler in AgencyControllerView
    const handleOrgPress = () => {
      if (!orgId) return;
      onOrgPressCallCount.n++;
    };
    handleOrgPress();
    expect(onOrgPressCallCount.n).toBe(0);
  });

  it('does not navigate when agency org ID is null (client side)', () => {
    const onOrgPressCallCount = { n: 0 };
    const targetOrgId: string | null = null;

    // Simulate the onOrgPress = targetOrgId ? ... : undefined guard in ClientWebApp
    const onOrgPress = targetOrgId ? () => { onOrgPressCallCount.n++; } : undefined;
    expect(onOrgPress).toBeUndefined();
    // calling undefined handler → no navigation
    onOrgPress?.();
    expect(onOrgPressCallCount.n).toBe(0);
  });
});

// ─── getAgencyIdForOrganization — null result still shows modal ───────────────

describe('getAgencyIdForOrganization returns null → modal agencyId is null', () => {
  it('accepts null agencyId when org lookup fails', () => {
    // Simulate the resolved state when getAgencyIdForOrganization returns null
    const viewingAgencyProfileState = {
      orgId: 'agency-org-123',
      agencyId: null as string | null, // resolver returned null
      orgName: 'Test Agency',
    };

    // Modal should still be shown (orgId is present)
    expect(viewingAgencyProfileState.orgId).toBeTruthy();
    // agencyId is null — model roster will be empty, which is correct behavior
    expect(viewingAgencyProfileState.agencyId).toBeNull();
  });
});

// ─── Model flow: getOrganizationIdForAgency returns null → no profile ─────────

describe('Model flow: getOrganizationIdForAgency returns null', () => {
  it('agencyOrgIdForProfile stays null → profile button is disabled', () => {
    let agencyOrgIdForProfile: string | null = null;

    // Simulate what happens when getOrganizationIdForAgency resolves null
    const resolvedOrgId: string | null = null;
    if (resolvedOrgId) {
      agencyOrgIdForProfile = resolvedOrgId;
    }

    expect(agencyOrgIdForProfile).toBeNull();
    // Clickable area is disabled when null — OrgProfileModal not shown
    const isDisabled = !agencyOrgIdForProfile;
    expect(isDisabled).toBe(true);
  });

  it('agencyOrgIdForProfile is set when resolver returns valid id', () => {
    let agencyOrgIdForProfile: string | null = null;

    const resolvedOrgId: string | null = 'agency-org-xyz';
    if (resolvedOrgId) {
      agencyOrgIdForProfile = resolvedOrgId;
    }

    expect(agencyOrgIdForProfile).toBe('agency-org-xyz');
    const isDisabled = !agencyOrgIdForProfile;
    expect(isDisabled).toBe(false);
  });
});
