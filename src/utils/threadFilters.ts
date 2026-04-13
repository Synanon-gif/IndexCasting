import type { OptionRequest } from '../store/optionRequests';

export type ThreadCounterparty = {
  id: string;
  label: string;
};

/**
 * Extract unique counterparties from option requests for the filter UI.
 * Agency view: groups by client org / client name.
 * Client view: groups by agency org / agency id.
 */
export function extractCounterparties(
  requests: OptionRequest[],
  role: 'agency' | 'client',
): ThreadCounterparty[] {
  const map = new Map<string, string>();
  for (const r of requests) {
    if (role === 'agency') {
      const key = r.clientOrganizationId ?? r.clientName ?? '';
      if (key && !map.has(key)) {
        map.set(key, r.clientOrganizationName ?? r.clientName ?? 'Client');
      }
    } else {
      const key = r.agencyOrganizationId ?? r.agencyId ?? '';
      if (key && !map.has(key)) {
        map.set(key, key);
      }
    }
  }
  return Array.from(map.entries())
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Filter requests by selected counterparty id.
 */
export function filterByCounterparty(
  requests: OptionRequest[],
  role: 'agency' | 'client',
  counterpartyId: string | null,
): OptionRequest[] {
  if (!counterpartyId) return requests;
  return requests.filter((r) => {
    if (role === 'agency') {
      return (r.clientOrganizationId ?? r.clientName ?? '') === counterpartyId;
    }
    return (r.agencyOrganizationId ?? r.agencyId ?? '') === counterpartyId;
  });
}
