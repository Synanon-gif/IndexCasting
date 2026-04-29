/**
 * Edge Function: ai-assistant
 *
 * Phase 1 only:
 * - authenticated callers only
 * - static IndexCasting help knowledge only
 * - no service_role
 * - no business-table reads, RPCs, writes, or private org data access
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const MISTRAL_API_KEY = Deno.env.get('MISTRAL_API_KEY') ?? '';

const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_MODEL = 'mistral-small-latest';
const MAX_INPUT_CHARS = 1200;
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_CHARS = 500;
const MAX_OUTPUT_TOKENS = 450;
const REQUEST_TIMEOUT_MS = 15_000;

type ViewerRole = 'agency' | 'client' | 'model';

type ChatMessage = {
  role?: unknown;
  content?: unknown;
};

type AssistantPayload = {
  message?: unknown;
  viewerRole?: unknown;
  history?: unknown;
};

const ALLOWED_ORIGINS = [
  'https://index-casting.com',
  'https://www.index-casting.com',
  'https://indexcasting.com',
  'https://www.indexcasting.com',
  'http://localhost:8081',
  'http://localhost:19006',
];

const LIVE_DATA_PATTERNS = [
  /\b(which|what|show|list|give me|tell me)\b.*\b(bookings?|options?|castings?|requests?|invoices?|messages?|models?|organization|team|members?)\b/i,
  /\b(status)\b.*\b(my|our|this)\b.*\b(request|option|casting|booking|invoice)\b/i,
  /\b(available|availability)\b.*\b(today|tomorrow|this week|next week|now)\b/i,
  /\b(who)\b.*\b(organization|team|company|agency|client)\b/i,
  /\b(what did|what has)\b.*\b(client|agency|model|booker|employee)\b.*\b(say|write|send)\b/i,
];

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function normalizeViewerRole(input: unknown): ViewerRole | null {
  if (input === 'agency' || input === 'client' || input === 'model') return input;
  return null;
}

function sanitizeText(input: string, maxChars: number): string {
  const cleaned = input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\b(ignore|override|forget)\b.*\b(system|developer|instruction|prompt)\b/gi, '')
    .replace(/\b(reveal|show|print)\b.*\b(system prompt|instructions|api key|secret|rls|database)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, maxChars);
}

function normalizeHistory(raw: unknown): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(-MAX_HISTORY_MESSAGES)
    .map((item: ChatMessage) => {
      const role = item?.role === 'assistant' ? 'assistant' : item?.role === 'user' ? 'user' : null;
      const content = typeof item?.content === 'string'
        ? sanitizeText(item.content, MAX_HISTORY_CHARS)
        : '';
      if (!role || !content) return null;
      return { role, content };
    })
    .filter((item): item is { role: 'user' | 'assistant'; content: string } => item != null);
}

function requiresLiveData(message: string): boolean {
  return LIVE_DATA_PATTERNS.some((pattern) => pattern.test(message));
}

function roleKnowledge(role: ViewerRole): string {
  if (role === 'agency') {
    return [
      'You are using IndexCasting as an Agency.',
      'Use exact Agency navigation labels: DASHBOARD, MY MODELS, CLIENTS, MESSAGES, CALENDAR, RECRUITING, TEAM, LINKS, BILLING, SETTINGS.',
      'Agency option creation: go to CALENDAR in the bottom navigation. Click ADD OPTION. Select or enter the model, client, date/time, and option details shown in the form. Save/create the option. The option appears in CALENDAR and can continue through confirmation or negotiation depending on the workflow.',
      'Agency casting creation: go to CALENDAR. Click ADD CASTING. Fill in the casting details. Save/create. A casting is not the same as a confirmed booking.',
      'Agency navigation help: use MY MODELS for model profile and media management, CLIENTS for client relationships, MESSAGES for conversations and negotiation threads, RECRUITING for model applications, TEAM for bookers, LINKS for packages or guest links, BILLING for billing location, and SETTINGS for account or organization settings.',
    ].join('\n');
  }
  if (role === 'client') {
    return [
      'You are using IndexCasting as a Client.',
      'Use client-facing navigation only: Dashboard, Discover, Projects, Messages, Calendar, Agencies, Team, Billing, Profile, and Settings where visible.',
      'Client option request workflow: use Discover or Projects to open the relevant model or selection. Choose Request option. Select the date/time and request details shown in the form. Send the request.',
      'Client casting request workflow: use Discover or Projects to open the relevant model or selection. Choose Request casting. Select the date/time and casting details shown in the form. Send the request.',
      'Do not use Agency-only navigation labels or buttons for Client help.',
      'Client navigation help: use Discover to find models, Projects to organize selections, Messages for agency conversations and negotiation threads, Calendar for visible request or job timing, Team for client organization employees, Billing for the client billing area when available, and Profile/Settings for account or organization details.',
    ].join('\n');
  }
  return [
    'You are using IndexCasting as a Model.',
    'Explain only basic model account, profile, application, media/profile completeness, and calendar concepts.',
    'Do not describe Agency-only or Client-only internal navigation as available to Models.',
  ].join('\n');
}

function buildSystemPrompt(role: ViewerRole): string {
  return [
    'You are IndexCasting AI Help.',
    'You only explain how the product works using the static help knowledge below.',
    'You do not have access to live data.',
    'You cannot perform actions.',
    'You must not invent bookings, models, requests, invoices, messages, organization data, people, dates, statuses, or availability.',
    'If a question requires live/private data, say: "I don\'t have access to your live data yet. I can explain where to find this in IndexCasting." Then give brief navigation guidance.',
    'Keep answers concise and practical.',
    'Use role-specific guidance for the viewer role and visible UI labels. Prefer short step-by-step answers.',
    'Do not invent navigation labels, buttons, screens, status values, or workflow steps.',
    'Never reveal internal security, RLS, database, API key, or implementation details.',
    '',
    `Viewer role: ${role}`,
    roleKnowledge(role),
    '',
    'Global help: Settings contains account and organization settings where available. Options are tentative holds or availability checks; castings are request/workflow contexts for evaluating talent; bookings are confirmed work or confirmed schedule items at a high level. For upload issues, check file type/size, refresh the browser, and retry. For invite issues, check the email address, invite permissions, and ask the owner/admin if needed. For persistent issues, contact support.',
    '',
    'Phase 1 boundary: no live account data, no private organization data, no database lookups, no actions.',
  ].join('\n');
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405, cors);
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('[ai-assistant] missing Supabase environment');
    return jsonResponse({ ok: false, error: 'assistant_unavailable' }, 503, cors);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401, cors);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401, cors);
  }

  let payload: AssistantPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400, cors);
  }

  const role = normalizeViewerRole(payload.viewerRole);
  if (!role) return jsonResponse({ ok: false, error: 'invalid_role' }, 400, cors);
  if (typeof payload.message !== 'string') {
    return jsonResponse({ ok: false, error: 'invalid_message' }, 400, cors);
  }
  if (payload.message.length > MAX_INPUT_CHARS) {
    return jsonResponse({ ok: false, error: 'message_too_long' }, 400, cors);
  }

  const message = sanitizeText(payload.message, MAX_INPUT_CHARS);
  if (!message) return jsonResponse({ ok: false, error: 'invalid_message' }, 400, cors);

  if (requiresLiveData(message)) {
    return jsonResponse({
      ok: true,
      answer:
        "I don't have access to your live data yet. I can explain where to find this in IndexCasting.",
    }, 200, cors);
  }

  if (!MISTRAL_API_KEY) {
    console.warn('[ai-assistant] missing MISTRAL_API_KEY');
    return jsonResponse({ ok: false, error: 'assistant_unavailable' }, 503, cors);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    // TODO Phase 2: add persistent per-user/org rate limits without reading business data.
    const mistralResponse = await fetch(MISTRAL_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MISTRAL_MODEL,
        temperature: 0.2,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          { role: 'system', content: buildSystemPrompt(role) },
          ...normalizeHistory(payload.history),
          { role: 'user', content: message },
        ],
      }),
    });

    if (!mistralResponse.ok) {
      console.warn('[ai-assistant] Mistral request failed', { status: mistralResponse.status });
      return jsonResponse({ ok: false, error: 'assistant_unavailable' }, 503, cors);
    }

    const data = await mistralResponse.json();
    const answer = data?.choices?.[0]?.message?.content;
    if (typeof answer !== 'string' || !answer.trim()) {
      return jsonResponse({ ok: false, error: 'assistant_unavailable' }, 503, cors);
    }

    return jsonResponse({ ok: true, answer: answer.trim() }, 200, cors);
  } catch (e) {
    console.warn('[ai-assistant] request failed', e instanceof Error ? e.name : 'unknown');
    return jsonResponse({ ok: false, error: 'assistant_unavailable' }, 503, cors);
  } finally {
    clearTimeout(timeout);
  }
});
