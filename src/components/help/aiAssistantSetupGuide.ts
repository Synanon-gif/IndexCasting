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
      'How does an option work?',
      'How does price negotiation work?',
      'How should I communicate with models?',
      'Explain Billing',
      'Help me set up my agency',
    ]);
  }
  if (role === 'client') {
    return Object.freeze([
      'How do I request an option?',
      'How does price negotiation work?',
      'How do I communicate with agencies?',
      'Explain My Projects',
      'Help me set up my workspace',
    ]);
  }
  return Object.freeze([] as string[]);
}
