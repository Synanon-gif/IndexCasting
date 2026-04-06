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
 */

import { assertOrgContext } from './orgGuard';
import {
  logAuditAction,
  logBookingAction,
  logOptionAction,
  logImageUpload,
  type AuditActionType,
} from '../services/gdprComplianceSupabase';

type BookingAuditAction = Parameters<typeof logBookingAction>[1];
type OptionAuditAction  = Parameters<typeof logOptionAction>[1];

export type LogActionOpts = {
  /**
   * Allow logging even when orgId is null/empty.
   * Only set to true in GDPR-internal flows (minor consent, image rights)
   * where the action is user-scoped rather than org-scoped.
   */
  allowEmptyOrg?: boolean;
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

export type LogPayload = BookingLog | OptionLog | ImageLog | AuditLog;

/**
 * Fire-and-forget audit log with mandatory org context guard.
 *
 * @param orgId   Organization ID. Must be non-empty unless `allowEmptyOrg` is true.
 * @param caller  Descriptive name of the calling function (for error logs).
 * @param payload What to log (discriminated union).
 * @param opts    Options (e.g. allowEmptyOrg for GDPR-internal flows).
 * @returns true if the log was dispatched, false if it was skipped (missing org context).
 */
export function logAction(
  orgId: string | null | undefined,
  caller: string,
  payload: LogPayload,
  opts: LogActionOpts = {},
): boolean {
  const { allowEmptyOrg = false } = opts;

  if (!allowEmptyOrg && !assertOrgContext(orgId, caller)) {
    return false;
  }

  const safeOrgId = orgId ?? '';

  switch (payload.type) {
    case 'booking':
      void logBookingAction(
        safeOrgId,
        payload.action,
        payload.entityId,
        payload.newData,
        payload.oldData,
      );
      break;

    case 'option':
      void logOptionAction(
        safeOrgId,
        payload.action,
        payload.entityId,
        payload.newData,
        payload.oldData,
      );
      break;

    case 'image':
      void logImageUpload(safeOrgId, payload.entityId, payload.newData);
      break;

    case 'audit':
      void logAuditAction({
        orgId:      safeOrgId,
        actionType: payload.action,
        entityType: payload.entityType,
        entityId:   payload.entityId,
        newData:    payload.newData,
        oldData:    payload.oldData,
      });
      break;

    default:
      payload satisfies never;
  }

  return true;
}
