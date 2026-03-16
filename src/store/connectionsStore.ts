/**
 * Client–Agency connections.
 * Backed by Supabase (client_agency_connections).
 * Local cache with sync API for UI compatibility.
 * Falls back to localStorage when Supabase FK constraints reject demo IDs.
 */

import {
  getAllConnections,
  insertConnection as insertInDb,
  updateConnectionStatus as updateInDb,
  deleteConnection as deleteInDb,
  type SupabaseConnection,
} from '../services/connectionsSupabase';

export type ConnectionStatus = 'pending' | 'accepted';

export type Connection = {
  id: string;
  clientId: string;
  agencyId: string;
  status: ConnectionStatus;
  requestedBy: 'client' | 'agency';
  createdAt: number;
};

const STORAGE_KEY = 'ci_connections';

function loadLocal(): Connection[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveLocal(conns: Connection[]) {
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conns)); }
    catch { /* ignore */ }
  }
}

function toLocal(c: SupabaseConnection): Connection {
  return {
    id: c.id,
    clientId: c.client_id,
    agencyId: c.agency_id,
    status: c.status,
    requestedBy: c.requested_by,
    createdAt: new Date(c.created_at).getTime(),
  };
}

let connections: Connection[] = loadLocal();
let hydrated = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((f) => f());
  saveLocal(connections);
}

async function ensureHydrated() {
  if (hydrated) return;
  hydrated = true;
  try {
    const remote = await getAllConnections();
    if (remote.length > 0) {
      connections = remote.map(toLocal);
      saveLocal(connections);
      notify();
    }
  } catch {
    // Keep localStorage data as fallback
  }
}

export function subscribeConnections(fn: () => void): () => void {
  listeners.add(fn);
  ensureHydrated();
  return () => listeners.delete(fn);
}

export function getConnections(): Connection[] {
  return [...connections];
}

export function getConnection(clientId: string, agencyId: string): Connection | undefined {
  return connections.find(
    (c) => c.clientId === clientId && c.agencyId === agencyId
  );
}

export function getConnectionsForClient(clientId: string): Connection[] {
  return connections.filter((c) => c.clientId === clientId);
}

export function getConnectionsForAgency(agencyId: string): Connection[] {
  return connections.filter((c) => c.agencyId === agencyId);
}

export function getConnectionsForAgencyByIdOrCode(agencyId: string, code?: string): Connection[] {
  return connections.filter(
    (c) => c.agencyId === agencyId || (!!code && c.agencyId === code)
  );
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

export function sendConnectionRequest(
  clientId: string,
  agencyId: string,
  requestedBy: 'client' | 'agency'
): Connection | null {
  if (connections.some((c) => c.clientId === clientId && c.agencyId === agencyId)) {
    return null;
  }
  const conn: Connection = {
    id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    clientId,
    agencyId,
    status: 'pending',
    requestedBy,
    createdAt: Date.now(),
  };
  connections.push(conn);
  notify();

  insertInDb(clientId, agencyId, requestedBy).then((result) => {
    if (result) {
      const c = connections.find((x) => x.id === conn.id);
      if (c) c.id = result.id;
      notify();
    }
  });

  return conn;
}

export function acceptConnection(connectionId: string): boolean {
  const c = connections.find((x) => x.id === connectionId);
  if (!c || c.status !== 'pending') return false;
  c.status = 'accepted';
  notify();
  updateInDb(connectionId, 'accepted');
  return true;
}

export function rejectConnection(connectionId: string): boolean {
  const idx = connections.findIndex((x) => x.id === connectionId);
  if (idx === -1) return false;
  connections.splice(idx, 1);
  notify();
  deleteInDb(connectionId);
  return true;
}
