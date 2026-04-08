import { supabase } from '../../lib/supabase';
import { listOrganizationMembers } from './organizationsInvitationsSupabase';

export type AssignmentFlagColor = 'gray' | 'blue' | 'green' | 'amber' | 'purple' | 'red';

export type ClientAssignmentFlag = {
  id: string;
  agencyOrganizationId: string;
  clientOrganizationId: string;
  label: string;
  color: AssignmentFlagColor;
  assignedMemberUserId: string | null;
  assignedMemberName: string | null;
  isArchived: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type ClientAssignmentRow = {
  id: string;
  agency_organization_id: string;
  client_organization_id: string;
  label: string;
  color: AssignmentFlagColor;
  assigned_member_user_id: string | null;
  is_archived: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type UpsertClientAssignmentInput = {
  agencyOrganizationId: string;
  clientOrganizationId: string;
  label: string;
  color: AssignmentFlagColor;
  assignedMemberUserId?: string | null;
  isArchived?: boolean;
};

function mapRow(
  row: ClientAssignmentRow,
  memberNames: Map<string, string | null>,
): ClientAssignmentFlag {
  const assignedMemberUserId = row.assigned_member_user_id ?? null;
  return {
    id: row.id,
    agencyOrganizationId: row.agency_organization_id,
    clientOrganizationId: row.client_organization_id,
    label: row.label,
    color: row.color,
    assignedMemberUserId,
    assignedMemberName: assignedMemberUserId ? (memberNames.get(assignedMemberUserId) ?? null) : null,
    isArchived: !!row.is_archived,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sanitizeLabel(label: string): string {
  return label.trim().slice(0, 40);
}

export async function listClientAssignmentFlagsForAgency(
  agencyOrganizationId: string,
): Promise<ClientAssignmentFlag[]> {
  if (!agencyOrganizationId) return [];
  try {
    const { data, error } = await supabase
      .from('client_assignment_flags')
      .select(
        'id, agency_organization_id, client_organization_id, label, color, assigned_member_user_id, is_archived, created_by, created_at, updated_at',
      )
      .eq('agency_organization_id', agencyOrganizationId)
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('listClientAssignmentFlagsForAgency error:', error);
      return [];
    }
    const rows = (data ?? []) as ClientAssignmentRow[];
    const members = await listOrganizationMembers(agencyOrganizationId);
    const names = new Map<string, string | null>(
      members.map((m) => [m.user_id, m.display_name ?? m.email ?? null]),
    );
    return rows.map((row) => mapRow(row, names));
  } catch (e) {
    console.error('listClientAssignmentFlagsForAgency exception:', e);
    return [];
  }
}

export async function upsertClientAssignmentFlag(
  input: UpsertClientAssignmentInput,
): Promise<ClientAssignmentFlag | null> {
  if (!input.agencyOrganizationId || !input.clientOrganizationId) return null;
  const label = sanitizeLabel(input.label);
  if (!label) return null;
  try {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;
    if (!userId) return null;
    const payload = {
      agency_organization_id: input.agencyOrganizationId,
      client_organization_id: input.clientOrganizationId,
      label,
      color: input.color,
      assigned_member_user_id: input.assignedMemberUserId ?? null,
      is_archived: input.isArchived ?? false,
      created_by: userId,
    };
    const { data, error } = await supabase
      .from('client_assignment_flags')
      .upsert(payload, {
        onConflict: 'agency_organization_id,client_organization_id',
      })
      .select(
        'id, agency_organization_id, client_organization_id, label, color, assigned_member_user_id, is_archived, created_by, created_at, updated_at',
      )
      .maybeSingle();
    if (error || !data) {
      console.error('upsertClientAssignmentFlag error:', error);
      return null;
    }
    const members = await listOrganizationMembers(input.agencyOrganizationId);
    const names = new Map<string, string | null>(
      members.map((m) => [m.user_id, m.display_name ?? m.email ?? null]),
    );
    return mapRow(data as ClientAssignmentRow, names);
  } catch (e) {
    console.error('upsertClientAssignmentFlag exception:', e);
    return null;
  }
}

export async function getClientAssignmentMapForAgency(
  agencyOrganizationId: string,
): Promise<Record<string, ClientAssignmentFlag>> {
  const rows = await listClientAssignmentFlagsForAgency(agencyOrganizationId);
  const map: Record<string, ClientAssignmentFlag> = {};
  rows.forEach((row) => {
    map[row.clientOrganizationId] = row;
  });
  return map;
}
