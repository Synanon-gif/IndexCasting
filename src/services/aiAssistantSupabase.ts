import { supabase } from '../../lib/supabase';
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
  if (!hasSingleCalendarItem && !hasSingleModel) return false;
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
