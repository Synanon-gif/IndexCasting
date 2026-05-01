import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';
import {
  AI_CONSENT_VERSION,
  AI_ASSISTANT_CONSENT_REQUIRED_ANSWER,
  AI_ASSISTANT_LEGAL_SECTIONS,
  AI_ASSISTANT_CONSENT_PLAIN_SUMMARY,
  AI_ASSISTANT_CONSENT_FOOTNOTE_VERSION,
  LAWFUL_BASIS_ACKNOWLEDGEMENT_COPY,
  RIGHTS_NON_WAIVER_NOTICE,
  PROVIDER_RETENTION_CONTROLS_CAVEAT,
  MISTRAL_TRAINING_CONFIGURATION_CAVEAT,
  MATERIAL_CHANGE_ACKNOWLEDGEMENT_COPY,
  INDEXCASTING_PUBLIC_TRUST_SUBPROCESSORS_URL,
} from '../../constants/aiAssistantConsent';

const migration = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261302_ai_assistant_user_consent.sql'),
  'utf8',
);

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
const allMigrationsSql = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .map((file) => readFileSync(path.join(migrationsDir, file), 'utf8'))
  .join('\n');

const modalTsx = readFileSync(
  path.join(process.cwd(), 'src/components/help/AiAssistantConsentModal.tsx'),
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
    expect(allMigrationsSql).toMatch(/ai_assistant_expected_consent_version/);
    expect(allMigrationsSql).toContain(AI_CONSENT_VERSION);
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
    expect(frontendService).toMatch(/ai_assistant_assert_consent_for_ai/);
    expect(frontendService).toMatch(/ai_assistant_user_consent/);
    expect(frontendService).not.toMatch(/\b(prompt_text|assistant_answer_text|raw_prompt)\b/i);
    expect(panel).not.toMatch(/AsyncStorage\.setItem\(.*consent/i);
  });
});

function aiAssistantConsentCopyCorpus(): string {
  const sections = AI_ASSISTANT_LEGAL_SECTIONS.map((section) =>
    [section.title, ...section.paragraphs].join('\n'),
  ).join('\n');
  return [
    ...AI_ASSISTANT_CONSENT_PLAIN_SUMMARY,
    sections,
    AI_ASSISTANT_CONSENT_FOOTNOTE_VERSION,
    modalTsx,
  ].join('\n');
}

describe('AI Assistant consent wording (legal hardening)', () => {
  const corpus = aiAssistantConsentCopyCorpus();

  it('states the assistant is optional and the app works without it', () => {
    expect(corpus).toMatch(/optional/i);
    expect(corpus).toMatch(/may be sent to our AI provider/i);
  });

  it('discloses limited data may be sent to Mistral / provider', () => {
    expect(corpus).toMatch(/Mistral/i);
    expect(corpus).toMatch(/may be sent|may be transmitted|may send limited/i);
  });

  it('does not claim no data leaves IndexCasting', () => {
    expect(corpus).not.toMatch(/no data .{0,120}leaves IndexCasting/i);
    expect(corpus).not.toMatch(/nothing leaves IndexCasting/i);
    expect(corpus).not.toMatch(/never leaves IndexCasting/i);
  });

  it('warns users not to enter sensitive categories of data', () => {
    expect(corpus.toLowerCase()).toMatch(/highly sensitive|sensitive information|payment details/i);
    expect(modalTsx).toMatch(/PROVIDER_RETENTION_CONTROLS_CAVEAT/);
  });

  it('warns that AI outputs may be wrong or outdated', () => {
    expect(corpus).toMatch(/wrong|outdated|incorrect/i);
  });

  it('states the assistant performs no write actions on the users behalf', () => {
    expect(corpus).toMatch(/does not perform write actions/i);
  });

  it('states material AI provider changes may require renewed acknowledgement', () => {
    expect(corpus).toContain(MATERIAL_CHANGE_ACKNOWLEDGEMENT_COPY);
    expect(corpus).toMatch(/materially change the AI provider/i);
  });

  it('includes lawful basis and non-waiver guardrails verbatim', () => {
    expect(corpus).toContain(LAWFUL_BASIS_ACKNOWLEDGEMENT_COPY);
    expect(corpus).toContain(RIGHTS_NON_WAIVER_NOTICE);
    expect(corpus).toContain(PROVIDER_RETENTION_CONTROLS_CAVEAT);
    expect(corpus).toContain(MISTRAL_TRAINING_CONFIGURATION_CAVEAT);
    expect(LAWFUL_BASIS_ACKNOWLEDGEMENT_COPY).toMatch(/consent is not the only legal basis/i);
  });

  it('surfaced public URLs match implemented legal routes without www subdomain drift', () => {
    expect(corpus).toContain('https://indexcasting.com/privacy');
    expect(corpus).toContain('https://indexcasting.com/trust/gdpr');
    expect(corpus).toContain(INDEXCASTING_PUBLIC_TRUST_SUBPROCESSORS_URL);
  });

  it('renders consent version string in footer constant', () => {
    expect(corpus).toContain(AI_CONSENT_VERSION);
  });
});
