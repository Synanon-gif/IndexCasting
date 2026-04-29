import { supabase } from '../../lib/supabase';
import type { AiAssistantViewerRole } from '../components/help/aiAssistantCopy';

const FUNCTION_NAME = 'ai-assistant';

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
  last_model_name?: string | null;
  last_intent?: string | null;
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
        context: input.context ?? null,
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
