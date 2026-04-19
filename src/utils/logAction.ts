/**
 * logAction — Centralized, org-guarded audit logging
 *
 * RULE: Every audit log call MUST go through this function (or an explicit
 * `allowEmptyOrg: true` override for GDPR-internal flows without org context).
 *
 * Pattern replaced:
 *   if (assertOrgContext(orgId, 'caller')) { void logBookingAction(orgId, ...) }
 *
 * Replaced by:
 *   void logAction(orgId, 'caller', { type: 'booking', action: 'booking_created', ... })
 *
 * GDPR-internal flows (no org context, e.g. confirmImageRights, minor consent):
 *   void logAction(null, 'confirmImageRights', { type: 'audit', ... }, { allowEmptyOrg: true })
 *
 * Source field (audit_trail.source — enterprise audit trail):
 *   Default: 'api'   — direct frontend Supabase call (most service calls)
 *   'rpc'            — server/admin-initiated call
 *   'system'         — background job, cron, or automated process
 *   'trigger'        — DB trigger-originated entry
 *
 *   Usage:
 *   void logAction(orgId, 'caller', { ... }, { source: 'rpc' })
 */

import { assertOrgContext } from './orgGuard';
import {
  logAuditAction,
  logBookingAction,
  logOptionAction,
  type AuditActionType,
  type AuditSource,
} from '../services/gdprComplianceSupabase';

type BookingAuditAction = Parameters<typeof logBookingAction>[1];
type OptionAuditAction = Parameters<typeof logOptionAction>[1];

export type LogActionOpts = {
  /**
   * Allow logging even when orgId is null/empty.
   * Only set to true in GDPR-internal flows (minor consent, image rights)
   * where the action is user-scoped rather than org-scoped.
   */
  allowEmptyOrg?: boolean;
  /**
   * How the action was triggered (stored in audit_trail.source).
   * Default: 'api'. Use 'rpc' for admin/server calls, 'system' for cron jobs.
   */
  source?: AuditSource;
};

type BookingLog = {
  type: 'booking';
  action: BookingAuditAction;
  entityId: string;
  newData?: Record<string, unknown>;
  oldData?: Record<string, unknown>;
};

type OptionLog = {
  type: 'option';
  action: OptionAuditAction;
  entityId: string;
  newData?: Record<string, unknown>;
  oldData?: Record<string, unknown>;
};

type ImageLog = {
  type: 'image';
  entityId: string;
  newData?: Record<string, unknown>;
};

type AuditLog = {
  type: 'audit';
  action: AuditActionType;
  entityType?: string;
  entityId?: string;
  newData?: Record<string, unknown>;
  oldData?: Record<string, unknown>;
};

// Billing-specific convenience payloads (20261122 — Phase B.5).
// Auto-set entityType so service-layer call sites stay short and consistent
// with the DB trigger's entity_type='invoice' on tr_invoices_log_status_change.
type InvoiceAuditAction =
  | 'invoice_draft_created'
  | 'invoice_draft_updated'
  | 'invoice_draft_deleted'
  | 'invoice_line_added'
  | 'invoice_line_updated'
  | 'invoice_line_deleted'
  | 'invoice_sent';

type InvoiceLog = {
  type: 'invoice';
  action: InvoiceAuditAction;
  entityId: string;
  newData?: Record<string, unknown>;
  oldData?: Record<string, unknown>;
};

type SettlementAuditAction =
  | 'settlement_created'
  | 'settlement_updated'
  | 'settlement_deleted'
  | 'settlement_marked_recorded'
  | 'settlement_marked_paid'
  | 'settlement_item_added'
  | 'settlement_item_deleted';

type SettlementLog = {
  type: 'settlement';
  action: SettlementAuditAction;
  entityId: string;
  newData?: Record<string, unknown>;
  oldData?: Record<string, unknown>;
};

export type LogPayload = BookingLog | OptionLog | ImageLog | AuditLog | InvoiceLog | SettlementLog;

/**
 * Fire-and-forget audit log with mandatory org context guard.
 *
 * @param orgId   Organization ID. Must be non-empty unless `allowEmptyOrg` is true.
 * @param caller  Descriptive name of the calling function (for error logs).
 * @param payload What to log (discriminated union: 'booking' | 'option' | 'image' | 'audit').
 * @param opts    Options: allowEmptyOrg (GDPR flows), source (audit trail origin).
 * @returns true if the log was dispatched, false if it was skipped (missing org context).
 */
export function logAction(
  orgId: string | null | undefined,
  caller: string,
  payload: LogPayload,
  opts: LogActionOpts = {},
): boolean {
  const { allowEmptyOrg = false, source = 'api' } = opts;

  if (!allowEmptyOrg && !assertOrgContext(orgId, caller)) {
    return false;
  }

  const safeOrgId = orgId ?? '';

  switch (payload.type) {
    case 'booking':
      void logAuditAction({
        orgId: safeOrgId,
        actionType: payload.action,
        entityType: 'booking',
        entityId: payload.entityId,
        newData: payload.newData,
        oldData: payload.oldData,
        source,
      });
      break;

    case 'option':
      void logAuditAction({
        orgId: safeOrgId,
        actionType: payload.action,
        entityType: 'option_request',
        entityId: payload.entityId,
        newData: payload.newData,
        oldData: payload.oldData,
        source,
      });
      break;

    case 'image':
      void logAuditAction({
        orgId: safeOrgId,
        actionType: 'image_uploaded',
        entityType: 'model',
        entityId: payload.entityId,
        newData: payload.newData,
        source,
      });
      break;

    case 'audit':
      void logAuditAction({
        orgId: safeOrgId,
        actionType: payload.action,
        entityType: payload.entityType,
        entityId: payload.entityId,
        newData: payload.newData,
        oldData: payload.oldData,
        source,
      });
      break;

    case 'invoice':
      void logAuditAction({
        orgId: safeOrgId,
        actionType: payload.action,
        entityType: 'invoice',
        entityId: payload.entityId,
        newData: payload.newData,
        oldData: payload.oldData,
        source,
      });
      break;

    case 'settlement':
      void logAuditAction({
        orgId: safeOrgId,
        actionType: payload.action,
        entityType: 'settlement',
        entityId: payload.entityId,
        newData: payload.newData,
        oldData: payload.oldData,
        source,
      });
      break;

    default:
      payload satisfies never;
  }

  return true;
}
