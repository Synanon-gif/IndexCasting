import type { AiAssistantViewerRole } from './aiAssistantCopy';

/** Documentation keys for structured setup knowledge (mirror server guide sections). */
export const AI_ASSISTANT_SETUP_SECTIONS = [
  'workspace_overview',
  'navigation',
  'setup_checklist',
  'feature_explanations',
  'billing_guidance',
  'calendar_guidance',
  'model_guidance',
  'client_guidance',
  'troubleshooting',
  'forbidden_sensitive_topics',
] as const;

export type AiAssistantSetupSection = (typeof AI_ASSISTANT_SETUP_SECTIONS)[number];

export function getAiAssistantQuickPrompts(role: AiAssistantViewerRole): readonly string[] {
  if (role === 'agency') {
    return Object.freeze([
      'Help me set up my agency',
      'What should I do first?',
      'Explain Calendar',
      'Explain Billing',
      'How do I add models?',
    ]);
  }
  if (role === 'client') {
    return Object.freeze([
      'Help me set up my client workspace',
      'What should I do first?',
      'Explain My Projects',
      'Explain Calendar',
      'Explain Billing',
    ]);
  }
  return Object.freeze([] as string[]);
}
