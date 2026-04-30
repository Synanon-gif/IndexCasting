import { readFileSync } from 'fs';
import * as path from 'path';
import {
  AI_CONSENT_VERSION,
  AI_ASSISTANT_CONSENT_REQUIRED_ANSWER,
} from '../../constants/aiAssistantConsent';

const migration = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261302_ai_assistant_user_consent.sql'),
  'utf8',
);

const edge = readFileSync(
  path.join(process.cwd(), 'supabase/functions/ai-assistant/index.ts'),
  'utf8',
);

const consentGate = readFileSync(
  path.join(process.cwd(), 'supabase/functions/ai-assistant/consentGate.ts'),
  'utf8',
);

const panel = readFileSync(
  path.join(process.cwd(), 'src/components/help/AiAssistantPanel.tsx'),
  'utf8',
);

const frontendService = readFileSync(
  path.join(process.cwd(), 'src/services/aiAssistantSupabase.ts'),
  'utf8',
);

describe('AI Assistant consent model & RLS', () => {
  it('defines composite PK scoped per user/org with no sensitive content columns', () => {
    expect(migration).toMatch(/PRIMARY KEY \(user_id, organization_id\)/);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/user_id = \(SELECT auth.uid\(\)\)/);
    expect(migration).toMatch(/organization_members/);
    expect(migration).not.toMatch(/\b(prompt|assistant_answer|message_text|reasoning_tokens)\b/i);
  });

  it('implements assert + upsert RPCs with SECURITY DEFINER and authenticated EXECUTE grants', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.ai_assistant_assert_consent_for_ai/,
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.ai_assistant_upsert_user_consent/,
    );
    expect(migration).toMatch(/SECURITY DEFINER/);
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.ai_assistant_assert_consent_for_ai\(uuid\) TO authenticated/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.ai_assistant_upsert_user_consent\(uuid, text\) TO authenticated/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.ai_assistant_user_consent FROM PUBLIC, anon/,
    );
  });

  it('anchors expected consent version centrally in Postgres', () => {
    expect(migration).toMatch(/ai_assistant_expected_consent_version/);
    expect(migration).toContain(AI_CONSENT_VERSION);
  });
});

describe('AI Assistant consent Edge gate', () => {
  const handlerStart = edge.indexOf('Deno.serve(async');

  it('enforces consent before classifyAssistantIntent runs', () => {
    expect(handlerStart).toBeGreaterThan(-1);
    const gateIdx = edge.indexOf('gateAiAssistantConsent', handlerStart);
    const classifyIdx = edge.indexOf('classifyAssistantIntent', handlerStart);
    expect(gateIdx).toBeGreaterThan(handlerStart);
    expect(gateIdx).toBeLessThan(classifyIdx);
  });

  it('responds with GDPR-friendly messaging without invoking downstream AI when blocked', () => {
    expect(edge).toMatch(/assistantAnswerResponse\(AI_ASSISTANT_CONSENT_REQUIRED_ANSWER/);
    expect(edge).not.toMatch(/Deno\.env\.get\(['"](?:SUPABASE_)?SERVICE_ROLE/i);
  });

  it('keeps Deno constants aligned with frontend legals bundle', () => {
    expect(consentGate).toContain(AI_CONSENT_VERSION);
    expect(consentGate).toContain(AI_ASSISTANT_CONSENT_REQUIRED_ANSWER);
    expect(AI_ASSISTANT_CONSENT_REQUIRED_ANSWER).toMatch(/AI usage requires acceptance/);
    expect(AI_CONSENT_VERSION).toMatch(/^v\d+_/);
  });
});

describe('AI Assistant frontend privacy integration', () => {
  it('blocks chat until consent is recorded for org-scoped users', () => {
    expect(panel).toMatch(/consentGate\.phase === 'blocked'/);
    expect(panel).toMatch(/editable=\{!pending && consentReady\}/);
    expect(panel).toMatch(/AiAssistantConsentModal/);
  });

  it('delegates acknowledgement persistence through narrow RPC wrappers', () => {
    expect(frontendService).toMatch(/ai_assistant_upsert_user_consent/);
    expect(frontendService).toMatch(/ai_assistant_user_consent/);
    expect(frontendService).not.toMatch(/\b(prompt_text|assistant_answer_text|raw_prompt)\b/i);
    expect(panel).not.toMatch(/AsyncStorage\.setItem\(.*consent/i);
  });
});
