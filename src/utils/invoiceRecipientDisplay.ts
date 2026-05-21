import { uiCopy } from '../constants/uiCopy';
import { getOrganizationName } from '../services/b2bOrgChatSupabase';
import { listAgencyOrganizationsForAgencyDirectory } from '../services/agencyOrganizationsDirectorySupabase';
import { listClientOrganizationsForAgencyDirectory } from '../services/clientOrganizationsDirectorySupabase';
import type { InvoiceType } from '../types/billingTypes';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True when the string looks like a UUID (must never be shown as a user-facing label). */
export function isUuidString(value: string): boolean {
  return UUID_RE.test(value.trim());
}

const SNAPSHOT_NAME_KEYS = [
  'billing_name',
  'legal_name',
  'company_name',
  'display_name',
  'name',
] as const;

/** Pull a human-readable recipient label from a frozen billing snapshot. */
export function recipientNameFromBillingSnapshot(
  snapshot: Record<string, unknown> | null | undefined,
): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  for (const key of SNAPSHOT_NAME_KEYS) {
    const raw = snapshot[key];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed || isUuidString(trimmed)) continue;
    return trimmed;
  }
  return null;
}

export function resolveInvoiceRecipientDisplayLabel(params: {
  recipientOrganizationId?: string | null;
  recipientBillingSnapshot?: Record<string, unknown> | null;
  resolvedOrganizationName?: string | null;
  fallbackLabel?: string;
}): string {
  const fromSnapshot = recipientNameFromBillingSnapshot(params.recipientBillingSnapshot);
  if (fromSnapshot) return fromSnapshot;

  const orgName = (params.resolvedOrganizationName ?? '').trim();
  if (orgName && !isUuidString(orgName)) return orgName;

  const fallback = params.fallbackLabel ?? uiCopy.common.unknownClient;
  const id = (params.recipientOrganizationId ?? '').trim();
  if (!id) return '—';
  if (isUuidString(id)) return fallback;
  return id;
}

/** Never expose internal org ids in visible invoice recipient labels. */
export function assertInvoiceRecipientLabelNotUuid(label: string): void {
  if (isUuidString(label)) {
    throw new Error(`Invoice recipient label must not be a UUID: ${label}`);
  }
}

/**
 * Resolve recipient organization display name for invoice drafts.
 * Keeps `recipient_organization_id` as the internal UUID; this is display-only.
 */
export async function fetchInvoiceRecipientOrganizationName(
  issuerOrganizationId: string,
  recipientOrganizationId: string,
  invoiceType: InvoiceType,
): Promise<string | null> {
  if (!recipientOrganizationId?.trim() || !issuerOrganizationId?.trim()) return null;

  try {
    const direct = await getOrganizationName(recipientOrganizationId);
    if (direct?.trim() && !isUuidString(direct)) return direct.trim();
  } catch (e) {
    console.warn('[fetchInvoiceRecipientOrganizationName] getOrganizationName failed:', e);
  }

  try {
    if (invoiceType === 'agency_to_client') {
      const rows = await listClientOrganizationsForAgencyDirectory(issuerOrganizationId, '');
      const hit = rows.find((r) => r.id === recipientOrganizationId);
      if (hit?.name?.trim()) return hit.name.trim();
    }
    if (invoiceType === 'agency_to_agency') {
      const rows = await listAgencyOrganizationsForAgencyDirectory(issuerOrganizationId, '');
      const hit = rows.find((r) => r.id === recipientOrganizationId);
      if (hit?.name?.trim()) return hit.name.trim();
    }
  } catch (e) {
    console.warn('[fetchInvoiceRecipientOrganizationName] directory lookup failed:', e);
  }

  return null;
}
