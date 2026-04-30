import { supabase } from '../../lib/supabase';
import { AI_CONSENT_VERSION } from '../constants/aiAssistantConsent';
import type { AiAssistantViewerRole } from '../components/help/aiAssistantCopy';

const FUNCTION_NAME = 'ai-assistant';
const AI_ASSISTANT_CONTEXT_TTL_MS = 10 * 60 * 1000;

export type AiAssistantContext = {
  last_calendar_item?: {
    date: string;
    start_time?: string | null;
    end_time?: string | null;
    kind: string;
    title: string | null;
    model_name: string | null;
    counterparty_name: string | null;
    note?: string | null;
  } | null;
  last_calendar_item_source?: 'single_resolved_item' | null;
  last_model_name?: string | null;
  last_model_source?: 'single_model_match' | null;
  last_availability_check_date?: string | null;
  last_availability_date_source?: 'single_day_resolve' | null;
  pending_calendar_kind_prompt?: boolean | null;
  last_intent?: string | null;
  context_created_at?: string | null;
  context_expires_at?: string | null;
};

export type AiAssistantMessage = {
  role: 'user' | 'assistant';
  content: string;
  context?: AiAssistantContext;
};

type EdgeOk = {
  ok: true;
  answer: string;
  context?: AiAssistantContext;
};

type EdgeErr = {
  ok: false;
  error?: string;
};

type EdgeResponse = EdgeOk | EdgeErr;

export type AiAssistantResult =
  | { ok: true; answer: string; context?: AiAssistantContext }
  | { ok: false; error: string };

export function isAiAssistantContextFresh(
  context: AiAssistantContext | null | undefined,
  now = Date.now(),
): context is AiAssistantContext {
  if (!context) return false;
  const hasSingleCalendarItem =
    Boolean(context.last_calendar_item) &&
    context.last_calendar_item_source === 'single_resolved_item';
  const hasSingleModel =
    Boolean(context.last_model_name) && context.last_model_source === 'single_model_match';
  const hasAvailabilityFollowup =
    context.last_intent === 'model_calendar_availability_check' &&
    context.last_availability_date_source === 'single_day_resolve' &&
    Boolean(context.last_availability_check_date);
  const hasPendingKindPick =
    Boolean(context.pending_calendar_kind_prompt) &&
    (context.last_intent === 'calendar_item_details' || context.last_intent === 'calendar_summary');
  if (
    !hasSingleCalendarItem &&
    !hasSingleModel &&
    !hasAvailabilityFollowup &&
    !hasPendingKindPick
  ) {
    return false;
  }
  if (
    typeof context.context_created_at !== 'string' ||
    typeof context.context_expires_at !== 'string'
  ) {
    return false;
  }
  const createdAt = Date.parse(context.context_created_at);
  const expiresAt = Date.parse(context.context_expires_at);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) return false;
  if (createdAt > now + 30_000) return false;
  if (expiresAt <= now) return false;
  if (expiresAt - createdAt > AI_ASSISTANT_CONTEXT_TTL_MS + 30_000) return false;
  return true;
}

export type AiAssistantConsentScope = {
  organizationId: string | null;
  consentRequired: boolean;
};

/**
 * Resolves the single unambiguous B2B organization context (agency or client) that the
 * AI assistant Edge function uses. Returns null if none or ambiguous.
 */
export async function resolveAiAssistantConsentOrganizationId(): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_my_org_context');
  if (error || data == null) return null;
  const rows = Array.isArray(data) ? data : [data];
  const supportedRows = rows.filter(
    (row: { org_type?: string | null }) => row.org_type === 'agency' || row.org_type === 'client',
  );
  if (supportedRows.length !== 1) return null;
  const id = supportedRows[0]?.organization_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export async function getAiAssistantConsentScope(): Promise<AiAssistantConsentScope> {
  const organizationId = await resolveAiAssistantConsentOrganizationId();
  return {
    organizationId,
    consentRequired: organizationId != null,
  };
}

export async function isAiAssistantConsentSatisfied(organizationId: string): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase
    .from('ai_assistant_user_consent')
    .select('consent_given, consent_version')
    .eq('user_id', user.id)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error || !data) return false;
  return Boolean(data.consent_given) && data.consent_version === AI_CONSENT_VERSION;
}

export async function recordAiAssistantUserConsent(
  organizationId: string,
): Promise<{ ok: boolean }> {
  const { error } = await supabase.rpc('ai_assistant_upsert_user_consent', {
    p_organization_id: organizationId,
    p_consent_version: AI_CONSENT_VERSION,
  });
  if (error) {
    const code =
      typeof (error as { code?: string }).code === 'string'
        ? (error as { code?: string }).code
        : 'unknown_rpc_error';
    console.warn('[aiAssistant][consent]', { event: 'persist_failed', code });
    return { ok: false };
  }
  console.info('[aiAssistant][consent]', {
    event: 'ack_recorded',
    consent_version: AI_CONSENT_VERSION,
  });
  return { ok: true };
}

export async function askAiAssistant(input: {
  message: string;
  viewerRole: AiAssistantViewerRole;
  history?: AiAssistantMessage[];
  context?: AiAssistantContext | null;
}): Promise<AiAssistantResult> {
  const message = input.message.trim();
  if (!message) return { ok: false, error: 'empty_message' };

  try {
    const { data, error } = await supabase.functions.invoke<EdgeResponse>(FUNCTION_NAME, {
      body: {
        message,
        viewerRole: input.viewerRole,
        history: (input.history ?? []).slice(-6),
        context: isAiAssistantContextFresh(input.context) ? input.context : null,
      },
    });

    if (error) {
      console.warn('[aiAssistant] invoke failed:', error.message);
      return { ok: false, error: 'assistant_unavailable' };
    }
    if (!data) return { ok: false, error: 'empty_response' };
    if (data.ok === true && typeof data.answer === 'string') {
      return { ok: true, answer: data.answer, context: data.context };
    }
    if (data.ok === false) {
      return { ok: false, error: data.error ?? 'assistant_unavailable' };
    }
    return { ok: false, error: 'assistant_unavailable' };
  } catch (e) {
    console.warn('[aiAssistant] exception:', e instanceof Error ? e.message : String(e));
    return { ok: false, error: 'assistant_unavailable' };
  }
}
