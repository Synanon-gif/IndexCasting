/**
 * AI Assistant voluntary-use consent bundle (frontend parity with Postgres
 * `public.ai_assistant_expected_consent_version()` and Edge `consentGate.ts`).
 * Bump constants, Postgres, and redeploy the Edge Function when substantive terms change.
 */
export const AI_CONSENT_VERSION = 'v2_2026_ai_consent';

/** Must match Edge `AI_ASSISTANT_CONSENT_REQUIRED_ANSWER` exactly. */
export const AI_ASSISTANT_CONSENT_REQUIRED_ANSWER =
  'AI usage requires acceptance of AI Assistant terms.';

export const AI_ASSISTANT_CONSENT_SCROLL_HINT =
  'Scroll through every section below before ticking the acknowledgement. This dialogue supplements your general Terms of Use and Privacy Notice; it does not replace them.';

export const AI_ASSISTANT_CONSENT_FOOTNOTE_VERSION = `Disclosure bundle version (linked to acknowledgement): ${AI_CONSENT_VERSION}`;

/** Public HTTPS pages — same paths as in-app public legal / trust routing. */
export const INDEXCASTING_PUBLIC_PRIVACY_URL = 'https://indexcasting.com/privacy';
export const INDEXCASTING_PUBLIC_TRUST_GDPR_URL = 'https://indexcasting.com/trust/gdpr';

/** Short plain-English orientation (above the detailed sections). */
export const AI_ASSISTANT_CONSENT_PLAIN_SUMMARY = [
  'The AI Assistant is optional—you can keep using IndexCasting without it.',
  'When you use it, limited text you type and minimized factual context may be sent to our AI provider (currently Mistral) for inference.',
  'Do not enter passwords, payment details, health data, or other highly sensitive information in the assistant.',
  'Responses can be wrong, incomplete, or outdated; check important facts in the product.',
  'The assistant does not perform write actions for you—confirm any change through the normal app controls.',
] as const;

export type AiAssistantConsentSection = {
  title: string;
  paragraphs: readonly string[];
};

export const LAWFUL_BASIS_ACKNOWLEDGEMENT_COPY =
  'Your acknowledgement enables the optional AI feature. Depending on the context, IndexCasting may rely on contract performance, legitimate interests, or consent where legally required. Details are provided in the Privacy Notice.';

export const RIGHTS_NON_WAIVER_NOTICE =
  'Nothing in this notice limits rights that cannot legally be waived.';

export const PROVIDER_RETENTION_CONTROLS_CAVEAT =
  'Depending on our active Mistral plan and settings, provider-side retention and training controls may differ. IndexCasting will configure available enterprise/privacy controls where commercially and technically available, and will document the applicable provider terms in the Privacy Notice.';

export const MATERIAL_CHANGE_ACKNOWLEDGEMENT_COPY =
  'If we materially change the AI provider, processing location, or categories of data shared, we will update this notice and may require a new acknowledgement.';

/**
 * Structured English disclosure for readability inside the modal.
 * Canonical regulatory detail remains in the Privacy Notice / Trust artefacts.
 */
export const AI_ASSISTANT_LEGAL_SECTIONS = [
  {
    title: '1. Scope of the Assistant (functional boundaries)',
    paragraphs: [
      'The AI Help Assistant is voluntary. You can close it at any time and continue using IndexCasting without conversational help.',
      'It responds to procedural and navigation questions inside the authenticated product workspace where the Assistant is offered.',
      'It does not place bookings, send messages, change settings, initiate payments, or otherwise perform actions on your behalf—only normal in-app confirmations do.',
      'Outputs explain how workflows are intended to work; they are not legal, fiscal, payroll, contractual, tariff, indemnity or compliance advice.',
      'Answers are informational only and may be incomplete, incorrect or out of step with unreleased roadmap changes.',
    ],
  },
  {
    title: '2. Personal data categories & purposes (summary)',
    paragraphs: [
      '(a) Text you voluntarily type to ask questions.',
      '(b) Optional short-lived session hints from prior assistant replies (for example deterministic metadata about a highlighted calendar row) when you continue that thread.',
      '(c) Minimised JSON “facts envelopes” from narrow read paths aligned with what your role can already see in the UI.',
      '(d) Quota and integrity metadata (coarse intent/result classes, coarse size estimates) for fair use—not full prompts or full model outputs stored for training here by design.',
      'Purposes: operating the optional help channel and protecting integrity and quotas. Operational staff may review security-relevant artefacts under least privilege. Language generation is delegated to Mistral AI (see below); sub-processor listings and transfer tools are summarized in the Privacy Notice and Trust materials linked from this modal.',
    ],
  },
  {
    title: '3. Data we do not deliberately route through this pathway',
    paragraphs: [
      'We do not deliberately ingest or summarise: unrelated raw negotiation mailboxes, cross-tenant dossiers, columns your UI withholds by design, unstructured billing artefacts beyond ordinary product access, MFA recovery material, unstructured bulk exports “for curiosity”, or pasted binaries unrelated to deterministic UI facts.',
      'Operational monitoring may throttle scripted abuse irrespective of quotas. Attempts at privilege escalation by prompt do not override access control enforced in the backend.',
    ],
  },
  {
    title: '4. Mistral AI (third-party provider)',
    paragraphs: [
      'Mistral AI is a third-party AI supplier. Depending on our contractual arrangement, Mistral may act as a processor, subprocessor, or analogous service provider—in each case instructed only for inference support, not for independent use of your data outside that purpose.',
      'To produce a reply, IndexCasting may send limited prompts (including your question text), server-side instructions, and optionally a minimized factual payload on a per-request basis. That inference step involves systems operated by Mistral; do not assume that all processing stays on IndexCasting-operated hosts for that step.',
      PROVIDER_RETENTION_CONTROLS_CAVEAT,
      'Transfers may rely on SCCs or other mechanisms described in corporate privacy materials; see the Privacy Notice rather than relying on abbreviated wording here.',
      MATERIAL_CHANGE_ACKNOWLEDGEMENT_COPY,
    ],
  },
  {
    title: '5. Retention (high level)',
    paragraphs: [
      'Composer payloads are not systematically written to usage-metering rows as verbatim chat logs.',
      'Quota telemetry uses bounded retention windows documented at a high level for operators; granular schedules reference enterprise transparency packs where available.',
      'Rows in `public.ai_assistant_user_consent` store acknowledgement metadata (version/time)—not conversational transcripts.',
    ],
  },
  {
    title: '6. Accuracy and human oversight',
    paragraphs: [
      'Responses may be wrong, truncated or culturally skewed—you should verify important outcomes.',
      'Today no assistant-only pathway makes solely automated decisions with legal or similarly significant effect about people; substantive actions still rely on confirmations in the audited UI.',
      'If capability changes, we address applicable transparency requirements separately.',
    ],
  },
  {
    title: '7. Limits of this notice',
    paragraphs: [
      RIGHTS_NON_WAIVER_NOTICE,
      'This panel orients you to the optional Assistant; it does not replace the Privacy Notice or Terms of Use.',
      'Where assistant text disagrees with the product UI after you save or confirm via normal controls, the committed application state governed by those controls prevails.',
    ],
  },
  {
    title: '8. Lawful bases & privacy rights (see Privacy Notice)',
    paragraphs: [
      LAWFUL_BASIS_ACKNOWLEDGEMENT_COPY,
      `Controller details, processing inventory, retention, rights requests, and supervisory contacts are in the Privacy Notice (${INDEXCASTING_PUBLIC_PRIVACY_URL}) and the Trust GDPR overview (${INDEXCASTING_PUBLIC_TRUST_GDPR_URL}).`,
      'Rights such as transparency, access, rectification, erasure, restriction, portability or objection depend on role and context; paths and limits are explained there.',
      'Withdrawal regarding this feature means we stop sending assistant traffic for your account until you acknowledge again if you choose to re-enable after a version change.',
    ],
  },
  {
    title: '9. Security posture (summary)',
    paragraphs: [
      'Tenancy is enforced in the application data layer; assistant fact envelopes follow the same membership rules as surfaced UI.',
      'Baseline transport protections follow platform standards; fuller security documentation is referenced from Trust/security materials.',
    ],
  },
  {
    title: '10. Acknowledgement per version',
    paragraphs: [
      'We record one acknowledgement per signed-in user and organisation tied to the version label below.',
      'You ordinarily will not be asked again until we bump `consent_version` or regulators require refreshed capture—including after material AI provider, location or data-scope changes described above.',
      'Administrators may govern acknowledgements under enterprise agreements outside this Assistant UI where applicable.',
    ],
  },
] as const satisfies readonly AiAssistantConsentSection[];

export const AI_ASSISTANT_CONSENT_CHECKBOX_LABEL =
  'I have read the information above and agree to use the AI Assistant on these terms.';
