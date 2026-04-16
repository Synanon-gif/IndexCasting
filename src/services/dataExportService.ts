/**
 * GDPR data export — Art. 15 / 20 (RPC `export_user_data`, current v4)
 * Normalizes `export_user_data` RPC JSON (snake_case keys) and optional domain grouping.
 */

import { supabase } from '../../lib/supabase';

/** Normalized GDPR export (camelCase) + domain grouping. */
export interface GdprDomainExport {
  meta: { exportVersion: number; exportedAt: string; userId: string };
  account: { profile: Record<string, unknown> | null };
  memberships: unknown[];
  consent: { consentLog: unknown[]; legalAcceptances: unknown[] };
  messaging: {
    messagesSent: unknown[];
    messagesReceived: unknown[];
    conversations: unknown[];
  };
  recruiting: { threads: unknown[]; messages: unknown[] };
  calendar: { userCalendarEvents: unknown[]; calendarEntries: unknown[] };
  business: {
    optionRequests: unknown[];
    optionRequestMessages: unknown[];
    optionDocuments: unknown[];
    clientProjects: unknown[];
    bookingEvents: unknown[];
  };
  model: { profileRows: unknown[]; photos: unknown[] };
  invitations: unknown[];
  notifications: unknown[];
  activityLogs: unknown[];
  auditTrail: unknown[];
  mediaCompliance: { imageRightsConfirmations: unknown[] };
  devices: { pushTokens: unknown[] };
}

export interface GdprExportResult {
  exportVersion: number;
  exportedAt: string;
  userId: string;
  profile: Record<string, unknown> | null;
  consentLog: unknown[];
  legalAcceptances: unknown[];
  organizations: unknown[];
  messagesSent: unknown[];
  messagesReceived: unknown[];
  conversations: unknown[];
  recruitingChatThreads: unknown[];
  recruitingChatMessages: unknown[];
  optionRequests: unknown[];
  optionRequestMessages: unknown[];
  optionDocuments: unknown[];
  modelProfile: unknown[];
  modelPhotos: unknown[];
  clientProjects: unknown[];
  invitations: unknown[];
  bookingEvents: unknown[];
  calendarEvents: unknown[];
  calendarEntries: unknown[];
  notifications: unknown[];
  activityLogs: unknown[];
  auditTrail: unknown[];
  imageRightsConfirmations: unknown[];
  pushTokens: unknown[];
  domains: GdprDomainExport;
}

export type DataExportResult<T = GdprExportResult> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return [];
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string' && v !== '') return Number(v) || fallback;
  return fallback;
}

/**
 * Maps raw JSONB from `export_user_data` into a stable camelCase shape + `domains` grouping.
 */
export function formatExportPayload(raw: unknown): GdprExportResult {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const profile = (r.profile as Record<string, unknown> | null) ?? null;
  const consentLog = asArray(r.consent_log);
  const legalAcceptances = asArray(r.legal_acceptances);
  const organizations = asArray(r.organizations);
  const messagesSent = asArray(r.messages_sent);
  const messagesReceived = asArray(r.messages_received);
  const conversations = asArray(r.conversations);
  const recruitingChatThreads = asArray(r.recruiting_chat_threads);
  const recruitingChatMessages = asArray(r.recruiting_chat_messages);
  const optionRequests = asArray(r.option_requests);
  const optionRequestMessages = asArray(r.option_request_messages);
  const optionDocuments = asArray(r.option_documents);
  const modelProfile = asArray(r.model_profile);
  const modelPhotos = asArray(r.model_photos);
  const clientProjects = asArray(r.client_projects);
  const invitations = asArray(r.invitations);
  const bookingEvents = asArray(r.booking_events);
  const calendarEvents = asArray(r.calendar_events);
  const calendarEntries = asArray(r.calendar_entries);
  const notifications = asArray(r.notifications);
  const activityLogs = asArray(r.activity_logs);
  const auditTrail = asArray(r.audit_trail);
  const imageRightsConfirmations = asArray(r.image_rights_confirmations);
  const pushTokens = asArray(r.push_tokens);

  const exportVersion = num(r.export_version, 1);
  const exportedAt = String(r.exported_at ?? '');
  const userId = String(r.user_id ?? '');

  const domains = {
    meta: { exportVersion, exportedAt, userId },
    account: { profile },
    memberships: organizations,
    consent: { consentLog, legalAcceptances },
    messaging: { messagesSent, messagesReceived, conversations },
    recruiting: { threads: recruitingChatThreads, messages: recruitingChatMessages },
    calendar: { userCalendarEvents: calendarEvents, calendarEntries },
    business: {
      optionRequests,
      optionRequestMessages,
      optionDocuments,
      clientProjects,
      bookingEvents,
    },
    model: { profileRows: modelProfile, photos: modelPhotos },
    invitations,
    notifications,
    activityLogs,
    auditTrail,
    mediaCompliance: { imageRightsConfirmations },
    devices: { pushTokens },
  };

  return {
    exportVersion,
    exportedAt,
    userId,
    profile,
    consentLog,
    legalAcceptances,
    organizations,
    messagesSent,
    messagesReceived,
    conversations,
    recruitingChatThreads,
    recruitingChatMessages,
    optionRequests,
    optionRequestMessages,
    optionDocuments,
    modelProfile,
    modelPhotos,
    clientProjects,
    invitations,
    bookingEvents,
    calendarEvents,
    calendarEntries,
    notifications,
    activityLogs,
    auditTrail,
    imageRightsConfirmations,
    pushTokens,
    domains,
  };
}

/**
 * Fetches GDPR export via RPC and triggers a JSON download in the browser.
 * On native, returns ok:false with reason `native_use_export_rpc` — callers should use
 * export success messaging without file download (see AgencySettingsTab pattern).
 */
export async function downloadUserData(
  userId: string,
): Promise<DataExportResult<GdprExportResult>> {
  try {
    const { data, error } = await supabase.rpc('export_user_data', { p_user_id: userId });
    if (error) {
      console.error('[dataExportService] export_user_data error:', error);
      if (error.message?.includes('permission_denied')) {
        return { ok: false, reason: 'permission_denied' };
      }
      return { ok: false, reason: error.message ?? 'export_failed' };
    }
    const formatted = formatExportPayload(data);
    if (typeof document !== 'undefined' && typeof Blob !== 'undefined') {
      const blob = new Blob([JSON.stringify(formatted, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `indexcasting-data-export-v${formatted.exportVersion}-${userId}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
    return { ok: true, data: formatted };
  } catch (e) {
    console.error('[dataExportService] downloadUserData exception:', e);
    return { ok: false, reason: 'exception' };
  }
}
