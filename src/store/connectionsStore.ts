/**
 * Client–Agency connections (Supabase `client_agency_connections`).
 * Load with fetchConnectionsForClient / fetchConnectionsForAgency after login.
 */

import {
  getConnectionsForClient as fetchClientRows,
  getConnectionsForAgency as fetchAgencyRows,
  getConnectionByClientAndAgency,
  insertConnection,
  updateConnectionStatus,
  deleteConnection,
  setConnectionConversationId,
  type SupabaseConnection,
} from '../services/connectionsSupabase';
import { getOrCreateConversation } from '../services/messengerSupabase';
import { collectParticipantUserIdsForConnection } from '../services/connectionChatParticipants';
import { getClientOrganizationIdForUser, getOrganizationIdForAgency } from '../services/organizationsInvitationsSupabase';

export type ConnectionStatus = 'pending' | 'accepted' | 'rejected';

export type Connection = {
  id: string;
  clientId: string;
  agencyId: string;
  status: ConnectionStatus;
  requestedBy: 'client' | 'agency';
  createdAt: number;
  conversationId?: string | null;
};

let connections: Connection[] = [];
const listeners = new Set<() => void>();

function toLocal(c: SupabaseConnection): Connection {
  return {
    id: c.id,
    clientId: c.client_id,
    agencyId: c.agency_id,
    status: c.status as ConnectionStatus,
    requestedBy: c.requested_by,
    createdAt: new Date(c.created_at).getTime(),
    conversationId: c.conversation_id ?? undefined,
  };
}

function notify() {
  listeners.forEach((f) => f());
}

export function subscribeConnections(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function fetchConnectionsForClient(clientId: string): Promise<void> {
  const remote = await fetchClientRows(clientId);
  const mapped = remote.map(toLocal);
  const others = connections.filter((c) => c.clientId !== clientId);
  connections = [...others, ...mapped];
  notify();
}

export async function fetchConnectionsForAgency(agencyId: string): Promise<void> {
  const remote = await fetchAgencyRows(agencyId);
  const mapped = remote.map(toLocal);
  const others = connections.filter((c) => c.agencyId !== agencyId);
  connections = [...others, ...mapped];
  notify();
}

export function getConnections(): Connection[] {
  return [...connections];
}

export function getConnectionsForClient(clientId: string): Connection[] {
  return connections.filter((c) => c.clientId === clientId);
}

export function getConnectionsForAgency(agencyId: string): Connection[] {
  return connections.filter((c) => c.agencyId === agencyId);
}

export function getConnection(clientId: string, agencyId: string): Connection | undefined {
  return connections.find((c) => c.clientId === clientId && c.agencyId === agencyId);
}

export function getConnectedAgencyIdsForClient(clientId: string): string[] {
  return connections
    .filter((c) => c.clientId === clientId && c.status === 'accepted')
    .map((c) => c.agencyId);
}

export function getConnectedClientIdsForAgency(agencyId: string): string[] {
  return connections
    .filter((c) => c.agencyId === agencyId && c.status === 'accepted')
    .map((c) => c.clientId);
}

export function getConnectionsForAgencyByIdOrCode(agencyId: string, code?: string): Connection[] {
  return connections.filter((c) => c.agencyId === agencyId || (!!code && c.agencyId === code));
}

export type SendConnectionResult =
  | { ok: true; connection: Connection }
  | { ok: false; duplicate?: boolean; reason?: string };

export async function sendConnectionRequest(
  clientId: string,
  agencyId: string,
  requestedBy: 'client' | 'agency',
  opts?: {
    createdBy?: string;
    fromOrganizationId?: string | null;
    toOrganizationId?: string | null;
  }
): Promise<SendConnectionResult> {
  const existingRow = await getConnectionByClientAndAgency(clientId, agencyId);
  if (existingRow) {
    const conn = toLocal(existingRow);
    const others = connections.filter((c) => !(c.clientId === clientId && c.agencyId === agencyId));
    connections = [conn, ...others];
    notify();
    return { ok: false, duplicate: true };
  }
  const result = await insertConnection({
    clientId,
    agencyId,
    requestedBy,
    createdBy: opts?.createdBy,
    fromOrganizationId: opts?.fromOrganizationId ?? undefined,
    toOrganizationId: opts?.toOrganizationId ?? undefined,
  });
  if (!result) {
    return { ok: false, duplicate: true };
  }
  const conn = toLocal(result);
  const others = connections.filter((c) => !(c.clientId === clientId && c.agencyId === agencyId));
  connections = [conn, ...others];
  notify();
  return { ok: true, connection: conn };
}

/**
 * Agency (or client) accepts a pending connection and opens a shared direct conversation for both orgs.
 */
export async function acceptConnectionAndCreateChat(params: {
  connectionId: string;
  actingUserId: string;
  clientUserId: string;
  agencyId: string;
}): Promise<{ ok: boolean; conversationId?: string }> {
  const row = connections.find((c) => c.id === params.connectionId);
  if (!row || row.status !== 'pending') {
    return { ok: false };
  }

  const participantIds = await collectParticipantUserIdsForConnection(
    params.clientUserId,
    params.agencyId,
    params.actingUserId
  );

  const [clientOrgId, agencyOrgId] = await Promise.all([
    getClientOrganizationIdForUser(params.clientUserId),
    getOrganizationIdForAgency(params.agencyId),
  ]);

  const conv = await getOrCreateConversation(
    'direct',
    participantIds,
    params.connectionId,
    'Client ↔ Agency',
    {
      createdBy: params.actingUserId,
      clientOrganizationId: clientOrgId,
      agencyOrganizationId: agencyOrgId,
    }
  );
  if (!conv) {
    console.error('acceptConnectionAndCreateChat: conversation not created');
    return { ok: false };
  }

  const updated = await updateConnectionStatus(params.connectionId, 'accepted');
  if (!updated) {
    return { ok: false };
  }

  await setConnectionConversationId(params.connectionId, conv.id);

  const c = connections.find((x) => x.id === params.connectionId);
  if (c) {
    c.status = 'accepted';
    c.conversationId = conv.id;
  }
  notify();
  return { ok: true, conversationId: conv.id };
}

export async function rejectIncomingConnection(connectionId: string): Promise<boolean> {
  const ok = await updateConnectionStatus(connectionId, 'rejected');
  if (ok) {
    connections = connections.map((c) => (c.id === connectionId ? { ...c, status: 'rejected' as const } : c));
    notify();
    return true;
  }
  const del = await deleteConnection(connectionId);
  if (del) {
    connections = connections.filter((c) => c.id !== connectionId);
    notify();
  }
  return del;
}
