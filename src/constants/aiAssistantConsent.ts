/**
 * AI Assistant voluntary-use consent bundle (frontend parity with Postgres
 * `ai_assistant_expected_consent_version()` and Edge `consentGate.ts`).
 * Bump constants, Postgres, and redeploy the Edge Function when substantive terms change.
 */
export const AI_CONSENT_VERSION = 'v1_2026_ai_terms';

/** Must match Edge `AI_ASSISTANT_CONSENT_REQUIRED_ANSWER` exactly. */
export const AI_ASSISTANT_CONSENT_REQUIRED_ANSWER =
  'AI usage requires acceptance of AI Assistant terms.';

export type AiAssistantConsentSection = {
  title: string;
  paragraphs: readonly string[];
};

/** In-product disclosure (English); the Privacy Notice remains the overarching statement. */
export const AI_ASSISTANT_LEGAL_SECTIONS = [
  {
    title: '1. What this AI does',
    paragraphs: [
      'The AI Help Assistant is optional. It provides guidance related to workflows and navigation in IndexCasting.',
      'Outputs are informational only. There is no guarantee of correctness or completeness.',
    ],
  },
  {
    title: '2. What data is processed',
    paragraphs: [
      'The text you submit in the assistant and short-lived session hints you deliberately carry forward may be processed to generate responses.',
      'Depending on your question and role, narrowly scoped system data visible to your account may also be summarized for the assistant in a minimized form—for example aggregated visible calendar information or factual fields from your visible roster/profile views.',
      'The assistant does not broaden what you can query in the underlying database compared with your normal authorised session.',
      'Operational metering retains only coarse metadata (for example classification of intent, outcome class, coarse character/token estimates used for quotas). Prompt and answer payloads are not written to metering tables.',
    ],
  },
  {
    title: '3. What is NOT processed',
    paragraphs: [
      'Designed exclusions include: covert access to concealed or private roster fields relative to your role, raw chats or inbox threads, undisclosed bookkeeping or invoice records, uploads and file payloads, covert cross-organisation lookups, covert export of Stripe or payment instrument details, covert GDPR export/delete artefacts, and unsolicited mass scraping of unrelated tables.',
      'Avoid entering unnecessary personal data. If uncertain, withhold it.',
    ],
  },
  {
    title: '4. Third-party processing (Mistral AI)',
    paragraphs: [
      'Language inference is performed by Mistral AI. Your question plus operating instructions supplied by IndexCasting, and optional minimized factual JSON envelopes, may be transmitted to Mistral for that request.',
      'Processing may occur on infrastructure outside IndexCasting. Commercial terms, privacy disclosures, SCCs/sub-processor mechanics, retention and DPIA artefacts are documented by Mistral and your organisation’s overarching processor agreements.',
      'The compose path is segregated so a future alternative LLM supplier can be swapped by configuration review without widening factual scope; substantive processor changes trigger versioned re-consent.',
    ],
  },
  {
    title: '5. Limitations',
    paragraphs: [
      'The assistant can be inaccurate, incomplete, stale, or misaligned with a later product release.',
      'You remain responsible for business decisions. Do not rely on the assistant alone for contractual, payroll, statutory, negotiation, tariff, indemnity or compliance-critical outcomes.',
      'There is no automated decision-making solely by this assistant that produces legal or similarly significant effects on you.',
    ],
  },
  {
    title: '6. Liability disclaimer',
    paragraphs: [
      'To the maximum extent permitted by law, operators disclaim liability arising from reliance on assistant output.',
      'Assistant replies are non-binding and do not modify contracts, approvals, invoicing statuses, calendar holds, GDPR decisions or security policies unless completed through proper in-product controls.',
      'Except where expressly required by statute, warranties are excluded.',
    ],
  },
  {
    title: '7. Data protection notice (GDPR summary)',
    paragraphs: [
      'Processing supports optional help delivery and metering. Lawful bases may include performance of contractual measures you request, legitimate interests in platform integrity paired with safeguards, plus your explicit acknowledgement recorded here.',
      'You may stop using the assistant at any time (use of other product areas continues subject to underlying terms). Withdrawal implies no further assistant calls until a future acknowledgement if you choose.',
      'This summary does not limit statutory GDPR rights—including access, rectification, erasure, restriction, portability, objection where applicable, and lodging complaints with a supervisory authority. Full privacy particulars appear in IndexCasting’s Privacy Notice.',
    ],
  },
  {
    title: '8. Security and tenancy',
    paragraphs: [
      'Row-Level Security plus narrow read-only envelopes constrain each request to your tenancy and role.',
      'You must not attempt to escalate privilege through conversational prompts.',
    ],
  },
] as const satisfies readonly AiAssistantConsentSection[];

export const AI_ASSISTANT_CONSENT_CHECKBOX_LABEL =
  'I understand and agree to the AI Assistant terms and data processing.';
