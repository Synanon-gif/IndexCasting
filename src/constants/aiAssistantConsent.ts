/**
 * AI Assistant voluntary-use consent bundle (frontend parity with Postgres
 * `public.ai_assistant_expected_consent_version()` and Edge `consentGate.ts`).
 * Bump constants, Postgres, and redeploy the Edge Function when substantive terms change.
 */
export const AI_CONSENT_VERSION = 'v3_2026_ai_consent_privacy';

/** Must match Edge `AI_ASSISTANT_CONSENT_REQUIRED_ANSWER` exactly. */
export const AI_ASSISTANT_CONSENT_REQUIRED_ANSWER =
  'AI usage requires acceptance of AI Assistant terms.';

export const AI_ASSISTANT_CONSENT_SCROLL_HINT =
  'Scroll through every section below before ticking the acknowledgement. This dialogue supplements your general Terms of Use and Privacy Notice; it does not replace them.';

export const AI_ASSISTANT_CONSENT_FOOTNOTE_VERSION = `Disclosure bundle version (linked to acknowledgement): ${AI_CONSENT_VERSION}`;

/** Public HTTPS pages — same paths as in-app public legal / trust routing. */
export const INDEXCASTING_PUBLIC_PRIVACY_URL = 'https://indexcasting.com/privacy';
export const INDEXCASTING_PUBLIC_TRUST_GDPR_URL = 'https://indexcasting.com/trust/gdpr';
/** Sub-processors list (includes AI provider entry for optional Assistant). */
export const INDEXCASTING_PUBLIC_TRUST_SUBPROCESSORS_URL =
  'https://indexcasting.com/trust/subprocessors';

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
  'Your acknowledgement enables the optional AI feature. IndexCasting may rely on contract performance (Art. 6(1)(b)) for delivering features you choose to use, legitimate interests (Art. 6(1)(f)) for security, rate limiting, and abuse prevention tied to the Assistant, and consent or explicit acknowledgement where legally required—consent is not the only legal basis that may apply. Details are in the Privacy Notice.';

export const RIGHTS_NON_WAIVER_NOTICE =
  'Nothing in this notice limits rights that cannot legally be waived.';

export const PROVIDER_RETENTION_CONTROLS_CAVEAT =
  'Depending on the active Mistral product, plan, and account settings, provider-side retention, abuse monitoring, and training controls may differ. Mistral may also process certain data as controller for purposes described in its terms (for example automated abuse detection; on some plans or settings, model training unless opted out).';

export const MISTRAL_TRAINING_CONFIGURATION_CAVEAT =
  'Where available and commercially/technically feasible, IndexCasting configures AI provider settings or plans so that customer input/output is not used for model training. If this materially changes, we will update this notice and may require a renewed AI acknowledgement.';

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
      'Purposes: product guidance and procedural help; limited read-only workflow support using allowlisted read paths; limited role-based answers from minimized visible facts; security, rate limiting, and abuse prevention for the Assistant.',
      '(a) Text you voluntarily type to ask questions.',
      '(b) Your workspace role and optional short-lived session hints from prior assistant replies (for example deterministic metadata about a highlighted calendar row) when you continue that thread.',
      '(c) Minimised JSON “facts envelopes” from narrow read paths aligned with what your role can already see in the UI, including where applicable: limited calendar summaries; visible calendar item details; visible agency model profile facts; and visible agency model calendar conflict summaries for a single day.',
      '(d) Quota and integrity metadata (coarse intent/result classes, coarse size estimates, organisation context for fair use)—not full prompts or full model outputs stored by IndexCasting for training.',
      'Language generation is delegated to Mistral AI (see below); sub-processor listings are in the Trust Center and Privacy Notice, linked from this modal.',
    ],
  },
  {
    title: '3. Data we do not deliberately route through this pathway',
    paragraphs: [
      'We do not intentionally send for Assistant inference: passwords; payment method or card data; Stripe or payment-provider secrets; raw full message threads or unrelated full chat exports; hidden model fields or hidden notes; file URLs or raw storage paths; service_role keys or database credentials; cross-organization datasets; internal descriptions of Row Level Security, schema, or other database implementation details—beyond the minimized facts described above.',
      'We do not deliberately ingest or summarise: unrelated raw negotiation mailboxes, cross-tenant dossiers, columns your UI withholds by design, unstructured billing artefacts beyond ordinary product access, MFA recovery material, unstructured bulk exports “for curiosity”, or pasted binaries unrelated to deterministic UI facts.',
      'Operational monitoring may throttle scripted abuse irrespective of quotas. Attempts at privilege escalation by prompt do not override access control enforced in the backend.',
    ],
  },
  {
    title: '4. Mistral AI (third-party provider)',
    paragraphs: [
      'Mistral AI (France) supplies the La Plateforme API used for language inference. In the typical API relationship, Mistral processes personal data in that flow as processor on customer instructions, governed by Mistral’s Data Processing Addendum and commercial terms where applicable. Depending on product, plan, and settings, Mistral may also process certain data as controller for purposes described in its terms (for example automated abuse detection; on some plans or settings, model training unless opted out or configured otherwise). Subprocessors and transfers are documented via Mistral’s Trust Center.',
      'IndexCasting uses the Mistral API platform for this integration only—not Mistral Le Chat or the Mistral Agent UI.',
      'To produce a reply, IndexCasting may send limited prompts (including your question text), your workspace role, server-side instructions, and optionally a minimized factual payload on a per-request basis. That inference step is performed on infrastructure operated by Mistral; it is not accurate to say that all processing for that step remains only on IndexCasting-operated hosts.',
      PROVIDER_RETENTION_CONTROLS_CAVEAT,
      MISTRAL_TRAINING_CONFIGURATION_CAVEAT,
      'International transfers may rely on adequacy decisions, Standard Contractual Clauses, or other mechanisms described in the Privacy Notice and Mistral’s materials—not on this summary alone.',
      `Further reading: Privacy Notice (${INDEXCASTING_PUBLIC_PRIVACY_URL}), Trust GDPR overview (${INDEXCASTING_PUBLIC_TRUST_GDPR_URL}), Sub-processors (${INDEXCASTING_PUBLIC_TRUST_SUBPROCESSORS_URL}).`,
      MATERIAL_CHANGE_ACKNOWLEDGEMENT_COPY,
    ],
  },
  {
    title: '5. Retention (high level)',
    paragraphs: [
      'IndexCasting does not store full prompts or full model responses as conversational transcripts in application usage logs.',
      'We retain limited usage metadata (for example coarse intent, coarse outcome, size estimates, organisation context) for security, rate limiting, abuse prevention, and operations—typically on the order of 30–90 days unless a longer period is required by law or for documented security reasons.',
      'Rows in `public.ai_assistant_user_consent` store acknowledgement metadata (version and time)—not chat transcripts.',
      'Mistral-side retention, abuse monitoring, and training are governed by Mistral’s applicable terms, DPA, and product settings.',
    ],
  },
  {
    title: '6. Accuracy and human oversight',
    paragraphs: [
      'Responses may be wrong, truncated or culturally skewed—you should verify important outcomes.',
      'Today no assistant-only pathway makes solely automated decisions with legal or similarly significant effect about people; the Assistant does not execute write actions or change application state. Substantive actions still rely on confirmations in the audited UI.',
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
      `Controller details, processing inventory, retention, rights requests, and supervisory contacts are in the Privacy Notice (${INDEXCASTING_PUBLIC_PRIVACY_URL}), the Trust GDPR overview (${INDEXCASTING_PUBLIC_TRUST_GDPR_URL}), and the Sub-processors list (${INDEXCASTING_PUBLIC_TRUST_SUBPROCESSORS_URL}).`,
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
