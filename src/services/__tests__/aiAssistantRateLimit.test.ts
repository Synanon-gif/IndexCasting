import { readFileSync } from 'fs';
import * as path from 'path';
import { uiCopy } from '../../constants/uiCopy';
import {
  AI_ASSISTANT_LIMIT_REACHED_ANSWER,
  AI_ASSISTANT_UNAVAILABLE_ANSWER,
  DEFAULT_AI_ASSISTANT_RATE_LIMITS,
  evaluateAiAssistantRateLimit,
  resolveAiAssistantRateLimits,
} from '../../../supabase/functions/ai-assistant/phase2';

const migration = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261216_ai_assistant_persistent_rate_limits.sql'),
  'utf8',
);

const edge = readFileSync(
  path.join(process.cwd(), 'supabase/functions/ai-assistant/index.ts'),
  'utf8',
);

const frontendService = readFileSync(
  path.join(process.cwd(), 'src/services/aiAssistantSupabase.ts'),
  'utf8',
);

describe('AI Assistant rate limit policy', () => {
  it('uses conservative defaults when an organization has no custom limits', () => {
    expect(resolveAiAssistantRateLimits(null)).toEqual({
      userHour: 20,
      userDay: 80,
      orgDay: 200,
    });
    expect(DEFAULT_AI_ASSISTANT_RATE_LIMITS).toEqual({
      userHour: 20,
      userDay: 80,
      orgDay: 200,
    });
  });

  it('uses organization-specific limits when they are valid', () => {
    expect(
      resolveAiAssistantRateLimits({
        user_hour_limit: 40,
        user_day_limit: 160,
        org_day_limit: 800,
      }),
    ).toEqual({
      userHour: 40,
      userDay: 160,
      orgDay: 800,
    });
  });

  it('falls back safely for invalid override values', () => {
    expect(
      resolveAiAssistantRateLimits({
        user_hour_limit: 0,
        user_day_limit: -1,
        org_day_limit: 2.5,
      }),
    ).toEqual(DEFAULT_AI_ASSISTANT_RATE_LIMITS);
  });

  it('allows usage below all limits and reports remaining counters after reservation', () => {
    expect(
      evaluateAiAssistantRateLimit({
        userHour: 19,
        userDay: 79,
        orgDay: 199,
      }),
    ).toEqual({
      allowed: true,
      reason: 'allowed',
      retryAfterSeconds: null,
      remainingUserHour: 0,
      remainingUserDay: 0,
      remainingOrgDay: 0,
    });
  });

  it('blocks at the user hourly limit with retry guidance', () => {
    expect(
      evaluateAiAssistantRateLimit(
        {
          userHour: 20,
          userDay: 20,
          orgDay: 20,
        },
        DEFAULT_AI_ASSISTANT_RATE_LIMITS,
        123,
      ),
    ).toMatchObject({
      allowed: false,
      reason: 'user_hour',
      retryAfterSeconds: 123,
      remainingUserHour: 0,
    });
  });

  it('blocks at the user daily limit', () => {
    expect(
      evaluateAiAssistantRateLimit({
        userHour: 1,
        userDay: 80,
        orgDay: 20,
      }),
    ).toMatchObject({
      allowed: false,
      reason: 'user_day',
      remainingUserDay: 0,
    });
  });

  it('blocks at the organization daily limit', () => {
    expect(
      evaluateAiAssistantRateLimit({
        userHour: 1,
        userDay: 2,
        orgDay: 200,
      }),
    ).toMatchObject({
      allowed: false,
      reason: 'org_day',
      remainingOrgDay: 0,
    });
  });
});

describe('AI Assistant rate limit SQL security contract', () => {
  it('creates narrow usage and limits tables with RLS and no frontend table grants', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.ai_assistant_usage_events/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.ai_assistant_limits/i);
    expect(migration).toMatch(
      /ALTER TABLE public\.ai_assistant_usage_events ENABLE ROW LEVEL SECURITY/i,
    );
    expect(migration).toMatch(/ALTER TABLE public\.ai_assistant_limits ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.ai_assistant_usage_events FROM PUBLIC, anon, authenticated/i,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.ai_assistant_limits FROM PUBLIC, anon, authenticated/i,
    );
  });

  it('uses SECURITY DEFINER RPCs with auth and org-membership guards', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.ai_assistant_check_rate_limit/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.ai_assistant_record_usage/i);
    expect(migration).toMatch(/SECURITY DEFINER/i);
    expect(migration).toMatch(/SET row_security TO off/i);
    expect(migration).toMatch(/v_uid uuid := auth\.uid\(\)/i);
    expect(migration).toMatch(/IF v_uid IS NULL THEN/i);
    expect(migration).toMatch(/public\.organization_members/i);
    expect(migration).toMatch(/p_organization_id <> v_org_id/i);
    expect(migration).toMatch(/org_context_mismatch/i);
  });

  it('does not allow anon RPC execution and grants only authenticated execute', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.ai_assistant_check_rate_limit\(uuid, text, text, uuid, integer\) FROM PUBLIC, anon/i,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.ai_assistant_check_rate_limit\(uuid, text, text, uuid, integer\) TO authenticated/i,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.ai_assistant_record_usage\(uuid, text, text, uuid, text, integer, integer, text, text, integer, text\) FROM PUBLIC, anon/i,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.ai_assistant_record_usage\(uuid, text, text, uuid, text, integer, integer, text, text, integer, text\) TO authenticated/i,
    );
  });

  it('stores metadata only and excludes prompt or answer content columns', () => {
    expect(migration).toMatch(/estimated_input_chars integer/i);
    expect(migration).toMatch(/estimated_output_chars integer/i);
    expect(migration).toMatch(/error_category text/i);
    expect(migration).not.toMatch(
      /\b(p_user_message|p_message_text|p_prompt|raw_prompt|assistant_answer|answer_text|response_text|access_token)\b/i,
    );
    expect(migration).toMatch(/Stores no prompt text, assistant answers/i);
  });

  it('adds indexes for scalable user, organization, and intent windows', () => {
    expect(migration).toMatch(/ai_assistant_usage_events_user_created_idx/i);
    expect(migration).toMatch(/ai_assistant_usage_events_org_created_idx/i);
    expect(migration).toMatch(/ai_assistant_usage_events_intent_created_idx/i);
    expect(migration).toMatch(/ai_assistant_limits_organization_idx/i);
  });

  it('records forbidden attempts as blocked_forbidden and rate-limit blocks as blocked_rate_limit', () => {
    expect(migration).toMatch(/'blocked_forbidden'/);
    expect(migration).toMatch(/'blocked_rate_limit'/);
    expect(edge).toMatch(/forbiddenIntentAnswer\(classification\.intent, role\)/);
    expect(edge).toMatch(/'blocked_forbidden'/);
  });

  it('prevents organization spoofing and cross-org counter manipulation', () => {
    expect(migration).toMatch(/p_organization_id IS NOT NULL AND p_organization_id <> v_org_id/i);
    expect(migration).toMatch(/WHERE om\.user_id = v_uid/i);
    expect(edge).not.toMatch(
      /payload\.organization_id|payload\.organizationId|organizationId:\s*payload/i,
    );
  });
});

describe('AI Assistant rate limit Edge integration', () => {
  it('authenticates with getUser before rate-limit checks', () => {
    expect(edge.indexOf('supabase.auth.getUser()')).toBeGreaterThan(-1);
    expect(edge.indexOf('supabase.auth.getUser()')).toBeLessThan(edge.indexOf('checkRateLimit({'));
  });

  it('checks the persistent rate limit before Mistral and live-data reads', () => {
    const checkIndex = edge.indexOf('checkRateLimit({');
    expect(checkIndex).toBeGreaterThan(-1);
    expect(checkIndex).toBeLessThan(edge.indexOf('callMistral({'));
    expect(checkIndex).toBeLessThan(edge.indexOf('loadCalendarFacts({'));
    expect(checkIndex).toBeLessThan(edge.indexOf('loadCalendarItemDetails({'));
    expect(checkIndex).toBeLessThan(edge.indexOf('loadModelVisibleProfileFacts({'));
  });

  it('fails closed if the limiter check fails and does not expose internals', () => {
    expect(edge).toMatch(/if \(!rateLimit\.ok\)/);
    expect(edge).toMatch(/AI_ASSISTANT_UNAVAILABLE_ANSWER/);
    expect(AI_ASSISTANT_UNAVAILABLE_ANSWER).toBe(
      'AI Help is temporarily unavailable. Please try again later.',
    );
  });

  it('returns a friendly limit message without exact limit numbers', () => {
    expect(edge).toMatch(/AI_ASSISTANT_LIMIT_REACHED_ANSWER/);
    expect(AI_ASSISTANT_LIMIT_REACHED_ANSWER).toBe(uiCopy.aiAssistant.limitReached);
    expect(AI_ASSISTANT_LIMIT_REACHED_ANSWER).not.toMatch(/\b20\b|\b80\b|\b200\b|SQL|RPC|RLS/i);
  });

  it('records long input as blocked_invalid before expensive calls', () => {
    const tooLongIndex = edge.indexOf("errorCategory: 'message_too_long'");
    expect(tooLongIndex).toBeGreaterThan(-1);
    expect(tooLongIndex).toBeLessThan(edge.indexOf('checkRateLimit({'));
    expect(edge).toMatch(/result: 'blocked_invalid'/);
  });

  it('keeps frontend free of service_role and direct usage table access', () => {
    expect(frontendService).not.toMatch(/service[_-]?role/i);
    expect(frontendService).not.toMatch(/ai_assistant_usage_events|ai_assistant_limits/i);
    expect(edge).not.toMatch(/Deno\.env\.get\(['"](?:SUPABASE_)?SERVICE_ROLE/i);
  });

  it('does not leak limits through assistant messages', () => {
    expect(edge).not.toMatch(/remaining_user_hour|remaining_org_day|user_hour_limit.*answer/i);
    expect(AI_ASSISTANT_LIMIT_REACHED_ANSWER).not.toMatch(/\d+\s*(requests?|per|\/)/i);
  });
});
