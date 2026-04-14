/**
 * GDPR & Legal Compliance Service — IndexCasting
 *
 * Covers:
 *   PART 1  — deleteOrganizationData(orgId)
 *   PART 3  — confirmImageRights(userId, modelId) — required before every upload
 *   PART 4  — setMinorFlag + setGuardianConsent + confirmMinorByAgency
 *   PART 5  — logAuditAction (extended audit trail)
 *   PART 6  — logSecurityEvent (extended incident types)
 *   PART 7  — (server-side) triggered via Edge Function / pg_cron
 *   PART 8  — exportUserData(userId) — GDPR Art. 20
 *
 * All functions:
 *   - call SECURITY DEFINER RPCs (no service_role key in frontend)
 *   - wrap every Supabase call in try/catch with specific error logging
 *   - return typed result objects (never raw Supabase errors)
 */

import { supabase } from '../../lib/supabase';
import {
  formatExportPayload,
  downloadUserData as downloadUserDataFromService,
} from './dataExportService';
import type { GdprExportResult } from './dataExportService';

export type { GdprExportResult } from './dataExportService';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Unified `{ ok, error }` shape for new Account/Org/GDPR call sites. */
export type { ServiceResult } from '../types/serviceResult';

export type ComplianceResult<T = void> = { ok: true; data: T } | { ok: false; reason: string };

export interface ImageRightsConfirmation {
  userId: string;
  modelId: string | null;
  /** Must be `public.organizations.id` (FK). Never pass `agencies.id`. */
  orgId?: string;
  sessionKey?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface MinorConsentRecord {
  modelId: string;
  guardianName?: string;
  guardianEmail?: string;
  guardianConsentConfirmed: boolean;
  agencyConfirmed: boolean;
  agencyConfirmedBy?: string;
  notes?: string;
}

export type AuditActionType =
  | 'user_deleted'
  | 'user_deletion_requested'
  | 'user_deletion_cancelled'
  | 'org_deleted'
  | 'data_exported'
  | 'booking_created'
  | 'booking_confirmed'
  | 'booking_cancelled'
  | 'booking_agency_accepted'
  | 'booking_model_confirmed'
  | 'booking_completed'
  | 'option_sent'
  | 'option_price_proposed'
  | 'option_price_countered'
  | 'option_price_accepted'
  | 'option_price_rejected'
  | 'option_confirmed'
  | 'option_rejected'
  | 'option_schedule_updated'
  | 'option_document_uploaded'
  | 'option_request_deleted'
  | 'application_accepted'
  | 'application_rejected'
  | 'profile_updated'
  | 'model_created'
  | 'model_updated'
  | 'model_removed'
  | 'model_visibility_changed'
  | 'image_rights_confirmed'
  | 'image_uploaded'
  | 'image_deleted'
  | 'minor_flagged'
  | 'minor_guardian_consent'
  | 'minor_agency_confirmed'
  | 'member_invited'
  | 'member_removed'
  | 'member_role_changed'
  | 'admin_override'
  | 'admin_profile_updated'
  | 'admin_subscription_changed'
  | 'login_failed'
  | 'permission_denied'
  | 'suspicious_activity';

export type SecurityEventType =
  | 'xss_attempt'
  | 'invalid_url'
  | 'file_rejected'
  | 'mime_mismatch'
  | 'extension_mismatch'
  | 'rate_limit'
  | 'large_payload'
  | 'magic_bytes_fail'
  | 'unsafe_content'
  | 'brute_force'
  | 'anomalous_access'
  | 'cross_org_attempt'
  | 'privilege_escalation_attempt'
  | 'suspicious_export'
  | 'unauthorized_deletion_attempt'
  | 'admin_anomaly'
  | 'guest_link_abuse';

export type AuditSource = 'api' | 'rpc' | 'system' | 'trigger';

export interface AuditLogParams {
  orgId: string | null;
  actionType: AuditActionType;
  entityType?: string;
  entityId?: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  ipAddress?: string;
  /**
   * How the action was triggered (stored in audit_trail.source).
   * Default: 'api' (direct frontend call).
   * Use 'rpc' for server/admin-initiated calls, 'system' for background jobs,
   * 'trigger' for DB-trigger-originated entries.
   */
  source?: AuditSource;
}

/**
 * Single source of truth for “recent confirmation” checks.
 * Must match {@link confirmImageRights} pre-insert window so guards never reject
 * a session that confirmImageRights would treat as still valid.
 */
export const IMAGE_RIGHTS_WINDOW_MINUTES = 60;

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — Organization deletion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Permanently deletes all data for an organization.
 * Callable only by the organization owner.
 * Logs the deletion in audit_trail before wiping.
 *
 * Storage cleanup: Collects model-photo storage paths BEFORE the RPC
 * deletes DB rows, then removes files from the documentspictures bucket
 * afterwards. Best-effort — storage failures do not block the RPC result.
 */
export async function deleteOrganizationData(orgId: string): Promise<ComplianceResult> {
  try {
    // Pre-collect storage paths before the RPC deletes DB rows.
    const storagePathsToDelete = await collectOrgStoragePaths(orgId);

    const { error } = await supabase.rpc('delete_organization_data', {
      p_org_id: orgId,
    });
    if (error) {
      console.error('[gdpr] deleteOrganizationData error:', error);
      if (error.message?.includes('only_owner_can_delete_organization')) {
        return { ok: false, reason: 'only_owner_can_delete_organization' };
      }
      return { ok: false, reason: error.message ?? 'unknown_error' };
    }

    // Best-effort storage cleanup after successful DB deletion.
    if (storagePathsToDelete.length > 0) {
      void cleanupStoragePaths('documentspictures', storagePathsToDelete);
    }

    return { ok: true, data: undefined };
  } catch (e) {
    console.error('[gdpr] deleteOrganizationData exception:', e);
    return { ok: false, reason: 'exception' };
  }
}

/**
 * Collects storage paths for model photos that belong to models of the org's
 * agency. Called before delete_organization_data wipes the DB rows.
 */
async function collectOrgStoragePaths(orgId: string): Promise<string[]> {
  try {
    const { data: org } = await supabase
      .from('organizations')
      .select('agency_id, type')
      .eq('id', orgId)
      .maybeSingle();

    if (!org?.agency_id || org.type !== 'agency') return [];

    const { data: photos } = await supabase
      .from('model_photos')
      .select('storage_path, model_id')
      .in(
        'model_id',
        supabase.from('models').select('id').eq('agency_id', org.agency_id) as unknown as string[],
      );

    if (!photos?.length) {
      // Fallback: list files by model_id prefix from models table
      const { data: models } = await supabase
        .from('models')
        .select('id')
        .eq('agency_id', org.agency_id);
      if (!models?.length) return [];

      const paths: string[] = [];
      for (const m of models) {
        try {
          const { data: files } = await supabase.storage
            .from('documentspictures')
            .list(`model-photos/${m.id}`, { limit: 1000 });
          if (files?.length) {
            paths.push(...files.map((f) => `model-photos/${m.id}/${f.name}`));
          }
        } catch {
          console.warn(`[gdpr] collectOrgStoragePaths: list failed for model ${m.id}`);
        }
      }
      return paths;
    }

    return photos
      .map((p) => (p as { storage_path?: string }).storage_path)
      .filter((p): p is string => !!p);
  } catch (e) {
    console.error('[gdpr] collectOrgStoragePaths exception:', e);
    return [];
  }
}

/**
 * Best-effort removal of storage objects. Processes in batches of 100.
 * Failures are logged but never thrown.
 */
async function cleanupStoragePaths(bucket: string, paths: string[]): Promise<void> {
  const BATCH = 100;
  for (let i = 0; i < paths.length; i += BATCH) {
    try {
      const batch = paths.slice(i, i + BATCH);
      const { error } = await supabase.storage.from(bucket).remove(batch);
      if (error) {
        console.error(`[gdpr] cleanupStoragePaths batch error (${bucket}):`, error);
      }
    } catch (e) {
      console.error(`[gdpr] cleanupStoragePaths batch exception (${bucket}):`, e);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 3 — Image rights confirmation (required before every upload)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Records that the user explicitly confirmed image rights before upload.
 * Must be called (and awaited) BEFORE the actual storage upload.
 * The upload should be rejected at the application layer if this returns { ok: false }.
 *
 * IDEMPOTENCY (fixed 20260406):
 *   1. Checks for a recent confirmation (60 min) first — returns early if found.
 *   2. INSERT is performed WITHOUT .select().single() to avoid PostgREST 409
 *      caused by RETURNING+RLS conflicts (policy may disallow SELECT on new row).
 *   3. Unique-constraint violations (23505) are treated as success — a prior
 *      confirmation already exists, which is the desired invariant.
 *   4. Foreign-key violations (23503) on org_id usually mean a non-organizations UUID
 *      was passed — fail closed; caller must pass `public.organizations.id`.
 *   5. Uses crypto.randomUUID() for the local confirmationId reference.
 */
export async function confirmImageRights(
  params: ImageRightsConfirmation,
): Promise<ComplianceResult<{ confirmationId: string }>> {
  try {
    // Step 1 — Check if a recent confirmation already exists (60 min window).
    // This avoids an unnecessary INSERT on repeated uploads in the same session.
    const alreadyConfirmed = params.modelId
      ? await hasRecentImageRightsConfirmation(
          params.userId,
          params.modelId,
          IMAGE_RIGHTS_WINDOW_MINUTES,
        )
      : params.sessionKey
        ? await hasRecentImageRightsForSessionKey(
            params.userId,
            params.sessionKey,
            IMAGE_RIGHTS_WINDOW_MINUTES,
          )
        : false;

    if (alreadyConfirmed) {
      return { ok: true, data: { confirmationId: 'reused' } };
    }

    // Step 2 — Attempt INSERT. Do NOT chain .select().single(): PostgREST
    // combines RETURNING with RLS SELECT policies; if the policy does not allow
    // the current user to SELECT the newly-written row, PostgREST returns a 409
    // even when the INSERT succeeded. We generate the id client-side instead.
    const localId = crypto.randomUUID();
    const { error } = await supabase.from('image_rights_confirmations').insert({
      user_id: params.userId,
      model_id: params.modelId ?? null,
      org_id: params.orgId ?? null,
      session_key: params.sessionKey ?? null,
      ip_address: params.ipAddress ?? null,
      user_agent: params.userAgent ?? null,
    });

    if (error) {
      // Step 3 — Unique constraint violation (23505): a prior confirmation exists.
      // Treat as success — the invariant (confirmation on record) is satisfied.
      if (error.code === '23505') {
        console.info('[gdpr] confirmImageRights: duplicate confirmation treated as OK');
        return { ok: true, data: { confirmationId: 'reused' } };
      }
      // FK violation (23503): e.g. org_id is not a valid organizations.id
      if (error.code === '23503') {
        console.error(
          '[gdpr] confirmImageRights: FK violation — org_id must reference public.organizations(id), not agencies.id',
          { code: error.code, message: error.message, details: error.details, hint: error.hint },
        );
        return { ok: false, reason: 'invalid_org_id' };
      }
      console.error('[gdpr] confirmImageRights error:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      return { ok: false, reason: error.message ?? 'insert_failed' };
    }

    // Audit: org may be absent (applicant / session-key flows) — use logAction + allowEmptyOrg (no orgId ?? '').
    void import('../utils/logAction').then(({ logAction }) => {
      logAction(
        params.orgId ?? undefined,
        'confirmImageRights',
        {
          type: 'audit',
          action: 'image_rights_confirmed',
          entityType: 'model',
          entityId: params.modelId ?? undefined,
          newData: { confirmation_id: localId, model_id: params.modelId },
        },
        { allowEmptyOrg: true },
      );
    });

    return { ok: true, data: { confirmationId: localId } };
  } catch (e) {
    console.error('[gdpr] confirmImageRights exception:', e);
    return { ok: false, reason: 'exception' };
  }
}

/**
 * Checks whether image rights were confirmed for a model within the last N minutes.
 * Use this guard immediately before triggering the storage upload.
 */
export async function hasRecentImageRightsConfirmation(
  userId: string,
  modelId: string,
  withinMinutes = IMAGE_RIGHTS_WINDOW_MINUTES,
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('image_rights_confirmations')
      .select('id')
      .eq('user_id', userId)
      .eq('model_id', modelId)
      .gte('confirmed_at', since)
      .limit(1)
      .maybeSingle();
    return !!data;
  } catch (e) {
    console.error('[gdpr] hasRecentImageRightsConfirmation exception:', e);
    return false;
  }
}

/**
 * Same as {@link hasRecentImageRightsConfirmation} but keyed by `session_key`
 * (e.g. recruiting-chat:{threadId} or option-doc:{requestId}) for uploads
 * without a model context.
 */
export async function hasRecentImageRightsForSessionKey(
  userId: string,
  sessionKey: string,
  withinMinutes = IMAGE_RIGHTS_WINDOW_MINUTES,
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('image_rights_confirmations')
      .select('id')
      .eq('user_id', userId)
      .eq('session_key', sessionKey)
      .gte('confirmed_at', since)
      .limit(1)
      .maybeSingle();
    return !!data;
  } catch (e) {
    console.error('[gdpr] hasRecentImageRightsForSessionKey exception:', e);
    return false;
  }
}

/**
 * Client-enforced guard for session-scoped uploads (chat attachments, option docs):
 * reads `image_rights_confirmations` via PostgREST/RLS (not Storage or an Edge Function).
 * Call after {@link confirmImageRights} with the same `sessionKey`.
 */
export async function guardUploadSession(
  userId: string,
  sessionKey: string,
): Promise<ComplianceResult> {
  const confirmed = await hasRecentImageRightsForSessionKey(
    userId,
    sessionKey,
    IMAGE_RIGHTS_WINDOW_MINUTES,
  );
  if (!confirmed) {
    void logSecurityEvent('file_rejected', {
      reason: 'image_rights_not_confirmed',
      user_id: userId,
      session_key: sessionKey,
    });
    return { ok: false, reason: 'image_rights_not_confirmed' };
  }
  return { ok: true, data: undefined };
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 4 — Minors safety
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Flags a model as a minor. Sets models.is_minor = true and creates
 * a model_minor_consent record if one doesn't exist yet.
 *
 * @deprecated Uses admin-only RPC `admin_update_model_minor_flag` — will fail
 * for non-admin callers with HTTP 400/403. Currently unused in the app.
 * If agency-level minor-flagging is needed, create a dedicated
 * `agency_update_model_minor_flag` RPC with org-membership guard.
 */
export async function flagModelAsMinor(
  modelId: string,
  guardianName?: string,
  guardianEmail?: string,
  orgId?: string,
): Promise<ComplianceResult> {
  try {
    const { error: modelError } = await supabase.rpc('admin_update_model_minor_flag', {
      p_model_id: modelId,
      p_is_minor: true,
    });

    if (modelError) {
      console.error('[gdpr] flagModelAsMinor model update error:', modelError);
      return { ok: false, reason: modelError.message };
    }

    const { error: consentError } = await supabase.from('model_minor_consent').upsert(
      {
        model_id: modelId,
        guardian_name: guardianName ?? null,
        guardian_email: guardianEmail ?? null,
        is_minor: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'model_id' },
    );

    if (consentError) {
      console.error('[gdpr] flagModelAsMinor consent upsert error:', consentError);
      return { ok: false, reason: consentError.message };
    }

    void logAuditAction({
      orgId: orgId ?? null,
      actionType: 'minor_flagged',
      entityType: 'model',
      entityId: modelId,
      newData: { is_minor: true, guardian_email: guardianEmail },
    });

    return { ok: true, data: undefined };
  } catch (e) {
    console.error('[gdpr] flagModelAsMinor exception:', e);
    return { ok: false, reason: 'exception' };
  }
}

/**
 * Records guardian consent for a minor model.
 */
export async function recordGuardianConsent(
  modelId: string,
  confirmed: boolean,
  orgId?: string,
): Promise<ComplianceResult> {
  try {
    const { error } = await supabase
      .from('model_minor_consent')
      .update({
        guardian_consent_confirmed: confirmed,
        guardian_consent_at: confirmed ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('model_id', modelId);

    if (error) {
      console.error('[gdpr] recordGuardianConsent error:', error);
      return { ok: false, reason: error.message };
    }

    void logAuditAction({
      orgId: orgId ?? null,
      actionType: 'minor_guardian_consent',
      entityType: 'model',
      entityId: modelId,
      newData: { guardian_consent_confirmed: confirmed },
    });

    return { ok: true, data: undefined };
  } catch (e) {
    console.error('[gdpr] recordGuardianConsent exception:', e);
    return { ok: false, reason: 'exception' };
  }
}

/**
 * Agency-side confirmation of minor consent.
 * Must be done by a booker or owner before the model becomes visible.
 */
export async function confirmMinorConsentByAgency(
  modelId: string,
  confirmedByUserId: string,
  orgId?: string,
): Promise<ComplianceResult> {
  try {
    const { error } = await supabase
      .from('model_minor_consent')
      .update({
        agency_confirmed: true,
        agency_confirmed_by: confirmedByUserId,
        agency_confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('model_id', modelId);

    if (error) {
      console.error('[gdpr] confirmMinorConsentByAgency error:', error);
      return { ok: false, reason: error.message };
    }

    void logAuditAction({
      orgId: orgId ?? null,
      actionType: 'minor_agency_confirmed',
      entityType: 'model',
      entityId: modelId,
      newData: { agency_confirmed_by: confirmedByUserId },
    });

    return { ok: true, data: undefined };
  } catch (e) {
    console.error('[gdpr] confirmMinorConsentByAgency exception:', e);
    return { ok: false, reason: 'exception' };
  }
}

/**
 * Returns true if a minor model has BOTH guardian + agency consent confirmed.
 * Use this before setting is_visible_fashion / is_visible_commercial = true.
 */
export async function isMinorFullyConsented(modelId: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('model_minor_consent')
      .select('guardian_consent_confirmed, agency_confirmed')
      .eq('model_id', modelId)
      .maybeSingle();
    return !!(data?.guardian_consent_confirmed && data?.agency_confirmed);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 5 — Audit trail (extended)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Logs an action to the immutable audit_trail table via SECURITY DEFINER RPC.
 * Fire-and-forget safe: errors are logged but never thrown.
 * orgId can be empty string '' when not in an org context (GDPR purge, export).
 */
export async function logAuditAction(params: AuditLogParams): Promise<void> {
  try {
    const { error } = await supabase.rpc('log_audit_action', {
      p_org_id: params.orgId || null,
      p_action_type: params.actionType,
      p_entity_type: params.entityType ?? null,
      p_entity_id: params.entityId ?? null,
      p_old_data: params.oldData ? JSON.stringify(params.oldData) : null,
      p_new_data: params.newData ? JSON.stringify(params.newData) : null,
      p_ip_address: params.ipAddress ?? null,
      p_source: params.source ?? 'api',
    });
    if (error) {
      console.error('[gdpr] logAuditAction error:', error);
    }
  } catch (e) {
    console.error('[gdpr] logAuditAction exception:', e);
  }
}

/**
 * Convenience: log a booking action.
 * Pass `oldState` to populate the audit_trail.old_data field with the state
 * before the transition (e.g. `{ status: 'pending' }`).
 */
export async function logBookingAction(
  orgId: string,
  action:
    | 'booking_created'
    | 'booking_confirmed'
    | 'booking_cancelled'
    | 'booking_agency_accepted'
    | 'booking_model_confirmed'
    | 'booking_completed',
  bookingId: string,
  details?: Record<string, unknown>,
  oldState?: Record<string, unknown>,
): Promise<void> {
  await logAuditAction({
    orgId,
    actionType: action,
    entityType: 'booking',
    entityId: bookingId,
    oldData: oldState,
    newData: details,
  });
}

/**
 * Convenience: log an option/price negotiation action.
 * Pass `oldState` to populate the audit_trail.old_data field with the state
 * before the transition (e.g. `{ status: 'in_negotiation' }`).
 */
export async function logOptionAction(
  orgId: string,
  action:
    | 'option_sent'
    | 'option_price_proposed'
    | 'option_price_countered'
    | 'option_price_accepted'
    | 'option_price_rejected'
    | 'option_confirmed'
    | 'option_rejected'
    | 'option_schedule_updated'
    | 'option_document_uploaded',
  optionId: string,
  details?: Record<string, unknown>,
  oldState?: Record<string, unknown>,
): Promise<void> {
  await logAuditAction({
    orgId,
    actionType: action,
    entityType: 'option_request',
    entityId: optionId,
    oldData: oldState,
    newData: details,
  });
}

/**
 * Convenience: log a model photo upload to the audit trail.
 */
export async function logImageUpload(
  orgId: string,
  modelId: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await logAuditAction({
    orgId,
    actionType: 'image_uploaded',
    entityType: 'model',
    entityId: modelId,
    newData: details,
  });
}

/**
 * Convenience: log a profile or model edit.
 */
export async function logProfileEdit(
  orgId: string,
  entityType: 'profile' | 'model',
  entityId: string,
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
): Promise<void> {
  await logAuditAction({
    orgId,
    actionType: entityType === 'model' ? 'model_updated' : 'profile_updated',
    entityType,
    entityId,
    oldData,
    newData,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 6 — Security event logging (extended types)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Logs a security event to the append-only security_events table.
 * Fire-and-forget safe. orgId is optional (pre-auth events have no org).
 */
export async function logSecurityEvent(
  type: SecurityEventType,
  metadata?: Record<string, unknown>,
  orgId?: string,
): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) {
      console.warn(
        '[gdpr] logSecurityEvent: no authenticated user — skipping DB insert',
        type,
        metadata,
      );
      return;
    }
    const { error } = await supabase.from('security_events').insert({
      user_id: user.id,
      org_id: orgId ?? null,
      type,
      metadata: metadata ?? null,
    });
    if (error) {
      console.error('[gdpr] logSecurityEvent error:', error);
    }
  } catch (e) {
    console.error('[gdpr] logSecurityEvent exception:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 8 — GDPR Data Export (Art. 20)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exports all personal data for a user.
 * Callable only by the user themselves or a super_admin.
 * The export is logged in audit_trail automatically (server-side RPC).
 */
export async function exportUserData(userId: string): Promise<ComplianceResult<GdprExportResult>> {
  try {
    const { data, error } = await supabase.rpc('export_user_data', {
      p_user_id: userId,
    });

    if (error) {
      console.error('[gdpr] exportUserData error:', error);
      if (error.message?.includes('permission_denied')) {
        return { ok: false, reason: 'permission_denied' };
      }
      return { ok: false, reason: error.message ?? 'export_failed' };
    }

    const result = formatExportPayload(data);
    return { ok: true, data: result };
  } catch (e) {
    console.error('[gdpr] exportUserData exception:', e);
    return { ok: false, reason: 'exception' };
  }
}

/**
 * Downloads the GDPR export as a JSON file in the browser.
 * Only works in a web context. Returns false if export failed.
 */
export async function downloadUserDataExport(userId: string): Promise<boolean> {
  const result = await downloadUserDataFromService(userId);
  if (!result.ok) {
    console.error('[gdpr] downloadUserDataExport failed:', result.reason);
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 9 — Security guards (application-layer helpers)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Guards an upload: confirms image rights are present (recent confirmation exists)
 * and logs a security event + rejects if missing.
 *
 * Usage:
 *   const guard = await guardImageUpload(userId, modelId);
 *   if (!guard.ok) { showError('You must confirm image rights first.'); return; }
 *   // proceed with upload...
 */
export async function guardImageUpload(userId: string, modelId: string): Promise<ComplianceResult> {
  const confirmed = await hasRecentImageRightsConfirmation(
    userId,
    modelId,
    IMAGE_RIGHTS_WINDOW_MINUTES,
  );
  if (!confirmed) {
    void logSecurityEvent('file_rejected', {
      reason: 'image_rights_not_confirmed',
      user_id: userId,
      model_id: modelId,
    });
    return { ok: false, reason: 'image_rights_not_confirmed' };
  }
  return { ok: true, data: undefined };
}

/**
 * Guards model visibility change for a minor:
 * blocks setting is_visible = true if guardian + agency consent are missing.
 */
export async function guardMinorVisibility(
  modelId: string,
  isMinor: boolean,
): Promise<ComplianceResult> {
  if (!isMinor) return { ok: true, data: undefined };

  const consented = await isMinorFullyConsented(modelId);
  if (!consented) {
    void logSecurityEvent('unauthorized_deletion_attempt', {
      reason: 'minor_consent_missing_before_visibility_change',
      model_id: modelId,
    });
    return {
      ok: false,
      reason: 'minor_consent_required: both guardian and agency must confirm',
    };
  }
  return { ok: true, data: undefined };
}
