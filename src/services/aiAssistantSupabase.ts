import { supabase } from '../../lib/supabase';
import type { AiAssistantViewerRole } from '../components/help/aiAssistantCopy';

const FUNCTION_NAME = 'ai-assistant';

export type AiAssistantMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type EdgeOk = {
  ok: true;
  answer: string;
};

type EdgeErr = {
  ok: false;
  error?: string;
};

type EdgeResponse = EdgeOk | EdgeErr;

export type AiAssistantResult = { ok: true; answer: string } | { ok: false; error: string };

export async function askAiAssistant(input: {
  message: string;
  viewerRole: AiAssistantViewerRole;
  history?: AiAssistantMessage[];
}): Promise<AiAssistantResult> {
  const message = input.message.trim();
  if (!message) return { ok: false, error: 'empty_message' };

  try {
    const { data, error } = await supabase.functions.invoke<EdgeResponse>(FUNCTION_NAME, {
      body: {
        message,
        viewerRole: input.viewerRole,
        history: (input.history ?? []).slice(-6),
      },
    });

    if (error) {
      console.warn('[aiAssistant] invoke failed:', error.message);
      return { ok: false, error: 'assistant_unavailable' };
    }
    if (!data) return { ok: false, error: 'empty_response' };
    if (data.ok === true && typeof data.answer === 'string') {
      return { ok: true, answer: data.answer };
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
