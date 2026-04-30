/**
 * AI Assistant voluntary-use consent bundle (frontend parity with Postgres
 * `public.ai_assistant_expected_consent_version()` and Edge `consentGate.ts`).
 * Bump constants, Postgres, and redeploy the Edge Function when substantive terms change.
 */
export const AI_CONSENT_VERSION = 'v1_2026_ai_terms';

/** Must match Edge `AI_ASSISTANT_CONSENT_REQUIRED_ANSWER` exactly. */
export const AI_ASSISTANT_CONSENT_REQUIRED_ANSWER =
  'AI usage requires acceptance of AI Assistant terms.';

export const AI_ASSISTANT_CONSENT_SCROLL_HINT =
  'Scroll through every section below before ticking the acknowledgement. This dialogue supplements your general Terms of Use and Privacy Notice; it does not replace them.';

export const AI_ASSISTANT_CONSENT_FOOTNOTE_VERSION = `Disclosure bundle version (linked to acknowledgement): ${AI_CONSENT_VERSION}`;

/** Public HTTPS pages suitable for GDPR / statutory cross-reference from the disclosure panel. */
export const INDEXCASTING_PUBLIC_PRIVACY_URL = 'https://www.indexcasting.com/privacy';
export const INDEXCASTING_PUBLIC_TRUST_GDPR_URL = 'https://www.indexcasting.com/trust/gdpr';

export type AiAssistantConsentSection = {
  title: string;
  paragraphs: readonly string[];
};

/**
 * Structured English disclosure for readability inside the modal.
 * Canonical regulatory detail remains in Privacy Notice / Trust Center artefacts.
 */
export const AI_ASSISTANT_LEGAL_SECTIONS = [
  {
    title: '1. Scope of the Assistant (functional boundaries)',
    paragraphs: [
      'The AI Help Assistant is voluntary. You can close it at any time and continue using IndexCasting without conversational help.',
      'It responds to procedural and navigation questions inside the product workspace you already authenticate to (Agency / Client surfaces where the button appears).',
      'Outputs explain how workflows are intended to work; they do not constitute professional legal, fiscal, payroll, contractual, tariff, indemnity or compliance advice.',
      'Answers are informational only. There is no warranty of completeness, correctness, suitability for business decisions or alignment with unreleased roadmap changes.',
    ],
  },
  {
    title: '2. Personal data categories & purposes (summarised Art. 13/14 anchors)',
    paragraphs: [
      '(a) Composer text — the wording you voluntarily enter to ask questions.',
      '(b) Optional short-lived session hints forwarded from preceding assistant replies (for example deterministic metadata about exactly one highlighted calendar row) when you deliberately continue that thread.',
      '(c) Minimised JSON “facts envelopes” hydrated from narrow SECURITY DEFINER read-RPCs reflecting information already visible inside your authorised UI (never columns hidden relative to your role).',
      '(d) Quota metering metadata (intent coarse class, success/failure class, coarse character/token estimates persisted in metering tables—not full prompts or verbatim completions today). Purposes are (i) supplying the conversational help channel you opted into and (ii) integrity / fair-use metering.',
      'Recipients are principally IndexCasting operators with least-privilege access for security investigations and contractual subprocessors mandated to process on documented instructions—for language inference currently Mistral AI (see Processor section below). Corporate processor registers, SCCs and sub-processor inventories are disclosed in Privacy / Trust artefacts (see URLs at the bottom of this modal).',
    ],
  },
  {
    title: '3. Data not intentionally surfaced through this assistant pathway',
    paragraphs: [
      'No intentional ingestion or summarisation of: raw chats or negotiation mailboxes unrelated to deterministic UI facts, covert cross-organisation dossiers relative to tenancy, covert hidden roster columns withheld from UX, unstructured invoices or bookkeeping objects outside what your billing UI already exposes with proper entitlement, unstructured GDPR-export ZIP archives “for curiosity”, unstructured vault exports, unstructured MFA recovery kits, unstructured upload binaries simply because you pasted them.',
      'Operational monitoring may throttle scripted abuse irrespective of Mistral quotas. Please do not attempt privilege escalation prompts—access control remains anchored in Postgres RLS, not conversational tone.',
    ],
  },
  {
    title: '4. Mistral AI (processor spotlight & transfers)',
    paragraphs: [
      'Language completions are outsourced to Mistral AI. Minimal instructional prompts plus optionally minimal JSON facts payloads travel to Mistral-hosted systems for ephemeral inference rounds.',
      'Transfers may rely on Standard Contractual Clauses and supplementary organisational or technical measures as described in prevailing corporate privacy packs; those instruments supersede abbreviated summary text if conflict arises historically vs. contemporaneous filing.',
      'If processor geography or legal instrument materially changes IndexCasting will bump `consent_version` and solicit fresh acknowledgement—you cannot silently inherit widened factual scope absent an engineering + legal review pairing.',
      'Architectural segregation (facts envelopes constrained to enumerated RPC surfaces) simplifies substituting alternate EU-aligned LLMs without widening database reach—supplier substitution still triggers governance review.',
    ],
  },
  {
    title: '5. Retention (engineering intent — detailed schedules elsewhere)',
    paragraphs: [
      'Composer payloads are not systematically archived into metering tables.',
      'Quota counters roll within bounded windows enforced by housekeeping jobs subject to overarching Data Retention Policy tables (available where your organisation obtains enterprise transparency packs).',
      'Acknowledgement ledger rows (`public.ai_assistant_user_consent`) intentionally store only acknowledgement flags/version/timestamp metadata for accountability—not transcripts.',
    ],
  },
  {
    title: '6. Limitations & human oversight (no consequential automation today)',
    paragraphs: [
      'The assistant may be wrong, truncated, culturally misaligned translation-wise or subtly stale versus code you deploy days later—independent substantive verification stays mandatory.',
      'No solely automated assistant-only branch today issues decisions producing legal effects or similarly significant effects about data subjects—you continue to confirm booking, payouts, dissolution and regulatory submissions through audited UI confirmations.',
      'If ever upgraded toward consequential automation GDPR Art. 22 / interpretive supervisory guidance overlays must be honoured with separate conspicuous disclosure + possibly divergent lawful bases.',
    ],
  },
  {
    title: '7. Liability (statutory carve-outs prevail)',
    paragraphs: [
      'Where mandatory consumer or employment statutes forbid blanket liability caps they override generic disclaim boilerplate—nothing here attempts illicit waiver.',
      'Otherwise organisational operators disclaim consequential damages arising purely from stochastic chat reliance absent separate executed professional services engagements.',
      'Assistant outputs neither amend executed contractual instruments elsewhere nor supersede supervisory orders—when chat contradicts audited UI authoritative source remains UI/state committed through proper workflow buttons.',
    ],
  },
  {
    title: '8. GDPR rights & lawful bases (outline — see Privacy artefacts for forms)',
    paragraphs: [
      `Layered lawful bases may combine contractual necessity for optional feature delivery, legitimate interest for integrity/quota metering (with balancing tests documented), explicit consent evidenced by affirmative checkbox after disclosure review. Withdrawal manifests as cessation of conversational calls until you reaffirm.`,
      `Controller identity, exhaustive processing inventory, supervisory contact channels, granular retention figures, DPIA summaries, SAR submission pathways—live upstream in authoritative Privacy artefacts (baseline public entry: ${INDEXCASTING_PUBLIC_PRIVACY_URL}), plus supplemental Trust transparency pages (baseline public entry GDPR hub: ${INDEXCASTING_PUBLIC_TRUST_GDPR_URL}).`,
      'Rights without truncation: transparency, access, rectification where technically feasible & not defeating incompatible lawful archival, erasure where legal grounds permit, restriction during contested lawful processing contests, portability for structured artefacts where unrelated export tooling already exists, objections where applicable statutes grant them, supervisory complaints.',
      'Nothing in this panel limits statutory claims or supervisory investigations—this is an orientation layer for an optional convenience feature.',
      'German / EU supervisory authority references detailed in organisational Privacy artefacts (e.g., contact details BaFin/LfD analogues)—not duplicated verbatim here to minimise stale contact drift.',
    ],
  },
  {
    title: '9. Technical & organisational security posture (summary)',
    paragraphs: [
      'Row-Level Security enforces tenancy; assistant RPC envelopes cannot traverse organisations beyond authentic membership semantics.',
      'Transport encryption baseline expectations inherit from platform stack posture (TLS etc.). Incident response escalation procedures live in SOC / DPIA appendix cross-links—not retyped here each release.',
    ],
  },
  {
    title: '10. One acknowledgement per bundled version (per workspace member row)',
    paragraphs: [
      'Postgres persists one composite row keyed by authenticated user × organisation acknowledging the bundled English disclosure text associated with cryptographic version slug below.',
      'After aligning with active version engineers label `consent_version`, you ordinarily will not revisit until legal/product governance bumps that slug or regulators demand fresh capture.',
      'Organisation administrators may programmatically revoke / audit acknowledgements pursuant to overarching enterprise agreements—outside assistant UI surface today—future UI toggles permissible without widening inference scope automatically.',
    ],
  },
] as const satisfies readonly AiAssistantConsentSection[];

export const AI_ASSISTANT_CONSENT_CHECKBOX_LABEL =
  'I understand and agree to the AI Assistant terms and data processing.';
