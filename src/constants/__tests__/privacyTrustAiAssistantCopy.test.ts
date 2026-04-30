import { expect } from '@jest/globals';
import { readFileSync } from 'fs';
import * as path from 'path';
import { uiCopy } from '../uiCopy';
import {
  INDEXCASTING_PUBLIC_PRIVACY_URL,
  INDEXCASTING_PUBLIC_TRUST_GDPR_URL,
  INDEXCASTING_PUBLIC_TRUST_SUBPROCESSORS_URL,
} from '../aiAssistantConsent';

const modalSource = readFileSync(
  path.join(process.cwd(), 'src/components/help/AiAssistantConsentModal.tsx'),
  'utf8',
);

describe('Privacy & Trust copy — AI Assistant / Mistral', () => {
  const privacy = uiCopy.legal.privacyAiAssistantBody;
  const gdprAi = uiCopy.trust.gdprAiAssistantBody;

  it('1 Privacy copy includes Mistral AI', () => {
    expect(uiCopy.legal.privacyAiAssistantTitle).toMatch(/AI Assistant and Mistral AI/);
    expect(privacy).toMatch(/Mistral AI/);
  });

  it('2 Privacy copy says limited prompts / minimized facts may be sent', () => {
    expect(privacy).toMatch(/question text|minimized|minimised/i);
    expect(privacy).toMatch(/facts|metadata/i);
  });

  it('3 Privacy copy says full prompts/responses are not stored in usage logs', () => {
    expect(privacy).toMatch(/does not store full prompts/i);
    expect(privacy).toMatch(/full model replies|not store full/i);
  });

  it('4 Privacy copy does NOT say no data leaves IndexCasting', () => {
    expect(privacy).not.toMatch(/no data .{0,120}leaves IndexCasting/i);
    expect(privacy).not.toMatch(/nothing leaves IndexCasting/i);
    expect(privacy).not.toMatch(/all processing stays (?:only )?on IndexCasting/i);
  });

  it('5 Privacy copy includes training / plan-settings caveat', () => {
    expect(privacy).toMatch(/plan|training|settings/i);
    expect(privacy).toMatch(/commercially\/technically feasible/i);
    expect(privacy).toMatch(/renewed.*acknowledgement/i);
  });

  it('6 Privacy copy includes legal basis wording without consent as sole basis', () => {
    expect(privacy).toMatch(/Consent is not the only basis/i);
    expect(privacy).toMatch(/contract performance|Art\. 6\(1\)\(b\)/i);
    expect(privacy).toMatch(/legitimate interests|Art\. 6\(1\)\(f\)/i);
  });

  it('7 Trust GDPR copy includes Mistral AI as optional assistant / subprocessor pointer', () => {
    expect(uiCopy.trust.gdprAiAssistantTitle).toMatch(/Mistral AI/);
    expect(gdprAi).toMatch(/Mistral AI|La Plateforme/i);
    expect(gdprAi).toMatch(/Sub-processors|Privacy Policy/i);
  });

  it('8 AI consent modal wires Privacy, Trust GDPR, and Sub-processors URL constants', () => {
    expect(modalSource).toMatch(/INDEXCASTING_PUBLIC_PRIVACY_URL/);
    expect(modalSource).toMatch(/INDEXCASTING_PUBLIC_TRUST_GDPR_URL/);
    expect(modalSource).toMatch(/INDEXCASTING_PUBLIC_TRUST_SUBPROCESSORS_URL/);
    expect(modalSource).toMatch(/openUrl\(INDEXCASTING_PUBLIC_PRIVACY_URL\)/);
  });

  it('10 AI Edge handler still gates consent before assistant classification', () => {
    const edge = readFileSync(
      path.join(process.cwd(), 'supabase/functions/ai-assistant/index.ts'),
      'utf8',
    );
    const start = edge.indexOf('Deno.serve(async');
    expect(start).toBeGreaterThan(-1);
    expect(edge.indexOf('gateAiAssistantConsent', start)).toBeLessThan(
      edge.indexOf('classifyAssistantIntent', start),
    );
  });
});
