import {
  isProductCalendarEducationQuestion,
  shouldExemptBillingOrTeamForbidden,
  type HelpStaticSubtype,
} from './setupGuide.ts';

export type { HelpStaticSubtype } from './setupGuide.ts';

export type ViewerRole = 'agency' | 'client' | 'model';

export type AssistantIntent =
  | 'help_static'
  | 'calendar_summary'
  | 'calendar_item_details'
  | 'model_visible_profile_facts'
  | 'model_calendar_availability_check'
  | 'billing'
  | 'team_management'
  | 'admin_security'
  | 'database_schema'
  | 'raw_messages'
  | 'cross_org'
  | 'write_action'
  | 'model_hidden_data'
  | 'gdpr_export_delete'
  | 'unknown_live_data';

export type CalendarDateRange = {
  startDate: string;
  endDate: string;
  wasCapped: boolean;
  /** Server returns ASC order; Edge may reorder facts when answering “last …” questions. */
  recentFirst?: boolean;
};

export type IntentClassification =
  | { intent: 'help_static'; helpSubtype?: HelpStaticSubtype }
  | { intent: 'calendar_summary'; dateRange: CalendarDateRange }
  | {
      intent: 'calendar_item_details';
      reference: 'followup' | 'last_job';
      requestedField: CalendarDetailRequestedField;
      kindHint?: CalendarSummaryItem['kind'];
    }
  | {
      intent: 'model_visible_profile_facts';
      searchText: string;
      needsClarification?: boolean;
      clarificationReason?: 'which_model' | 'what_info';
    }
  | {
      intent: 'model_calendar_availability_check';
      searchText: string;
      checkDate?: string;
      needsDateClarification?: boolean;
      dateAmbiguous?: boolean;
      needsModelClarification?: boolean;
    }
  | {
      intent: Exclude<
        AssistantIntent,
        | 'help_static'
        | 'calendar_summary'
        | 'calendar_item_details'
        | 'model_visible_profile_facts'
        | 'model_calendar_availability_check'
      >;
    };

export type CalendarSummaryItem = {
  date: string;
  start_time: string | null;
  end_time: string | null;
  kind: 'option' | 'casting' | 'job' | 'private_event' | 'booking';
  title: string;
  model_name: string | null;
  counterparty_name: string | null;
  status_label: string;
  note: string | null;
};

export type CalendarFacts = {
  intent: 'calendar_summary';
  role: Extract<ViewerRole, 'agency' | 'client'>;
  startDate: string;
  endDate: string;
  showingFirst: number;
  hasMore: boolean;
  rangeWasCapped: boolean;
  items: CalendarSummaryItem[];
};

export type CalendarDetailRequestedField =
  | 'summary'
  | 'counterparty'
  | 'model'
  | 'date'
  | 'description'
  | 'pricing';

export type CalendarItemReference = {
  date: string;
  start_time?: string | null;
  end_time?: string | null;
  kind: CalendarSummaryItem['kind'];
  title: string;
  model_name: string | null;
  counterparty_name: string | null;
  status_label: string | null;
  note?: string | null;
};

export type AiAssistantContext = {
  last_calendar_item?: CalendarItemReference | null;
  last_calendar_item_source?: 'single_resolved_item' | null;
  last_model_name?: string | null;
  last_model_source?: 'single_model_match' | null;
  last_availability_check_date?: string | null;
  last_availability_date_source?: 'single_day_resolve' | null;
  /** True after an ambiguous calendar follow-up asked which item/kind; enables one-word kind replies. */
  pending_calendar_kind_prompt?: boolean | null;
  last_intent?: Extract<
    AssistantIntent,
    | 'help_static'
    | 'calendar_summary'
    | 'calendar_item_details'
    | 'model_visible_profile_facts'
    | 'model_calendar_availability_check'
  > | null;
  context_created_at?: string | null;
  context_expires_at?: string | null;
};

export type CalendarItemDetailsFacts = {
  intent: 'calendar_item_details';
  role: Extract<ViewerRole, 'agency' | 'client'>;
  matchStatus: 'none' | 'ambiguous' | 'found';
  requestedField: CalendarDetailRequestedField;
  candidates?: CalendarItemReference[];
  item?: CalendarSummaryItem;
};

export type ModelVisibleProfileRow = {
  display_name?: unknown;
  city?: unknown;
  country?: unknown;
  height?: unknown;
  chest?: unknown;
  waist?: unknown;
  hips?: unknown;
  shoes?: unknown;
  hair?: unknown;
  eyes?: unknown;
  categories?: unknown;
  account_linked?: unknown;
};

export type ModelVisibleProfileCandidate = {
  display_name: string;
  city: string | null;
  country: string | null;
};

export type ModelVisibleProfileFacts = {
  intent: 'model_visible_profile_facts';
  role: 'agency';
  matchStatus: 'none' | 'ambiguous' | 'found';
  candidates?: ModelVisibleProfileCandidate[];
  model?: ModelVisibleProfileCandidate & {
    measurements: {
      height: number | null;
      chest: number | null;
      waist: number | null;
      hips: number | null;
      shoes: number | null;
    };
    hair: string | null;
    eyes: string | null;
    categories: string[];
    account_linked: boolean;
  };
};

export type ModelFactsExecutionResult =
  | { type: 'answer'; answer: string }
  | { type: 'mistral'; facts: ModelVisibleProfileFacts };

export type ModelCalendarAvailabilityEvent = {
  kind_label: string;
  start_time: string | null;
  end_time: string | null;
  title: string;
  counterparty_name: string | null;
  note: string | null;
};

export type ModelCalendarAvailabilityFacts = {
  intent: 'model_calendar_availability_check';
  role: 'agency';
  disclaimer: string;
  model_display_name: string;
  check_date: string;
  has_visible_conflicts: boolean;
  events: ModelCalendarAvailabilityEvent[];
};

export type AiAssistantRateLimits = {
  userHour: number;
  userDay: number;
  orgDay: number;
};

export type AiAssistantRateLimitCounts = {
  userHour: number;
  userDay: number;
  orgDay: number | null;
};

export type AiAssistantRateLimitDecision = {
  allowed: boolean;
  reason: 'allowed' | 'user_hour' | 'user_day' | 'org_day';
  retryAfterSeconds: number | null;
  remainingUserHour: number;
  remainingUserDay: number;
  remainingOrgDay: number | null;
};

export const CALENDAR_UNSUPPORTED_RANGE_ANSWER =
  'I can answer limited calendar questions for a specific date range. Try asking what is on your calendar today, tomorrow, or next week.';
export const MODEL_CLARIFICATION_ANSWER = 'Which model do you mean?';
export const MODEL_INFO_CLARIFICATION_PREFIX = 'What information do you need about';
export const CLIENT_MODEL_FACTS_REFUSAL =
  'I can’t access agency-only model profile facts from the Client workspace.';
export const CLIENT_MODEL_AVAILABILITY_REFUSAL =
  'I can’t check agency model availability from the Client workspace. You can create or review requests in the Client calendar or workflow.';
export const MODEL_WORKSPACE_AVAILABILITY_REFUSAL =
  'I can’t check agency model calendar conflicts from the Model workspace.';
export const AVAILABILITY_DISCLAIMER =
  'I can check visible calendar conflicts, but this is not a final availability confirmation.';
export const AI_ASSISTANT_LIMIT_REACHED_ANSWER =
  'You’ve reached the AI assistant usage limit. Please try again later. Contact your organization admin if you need higher limits.';
export const AI_ASSISTANT_UNAVAILABLE_ANSWER =
  'AI Help is temporarily unavailable. Please try again later.';
export const AI_ASSISTANT_RATE_LIMIT_CHECK_FAILED_ANSWER =
  'AI Help could not verify usage limits right now. Please try again.';

/** Limiter RPC rejected org membership / org id pairing (distinct from transient infra failure). */
export const AI_ASSISTANT_LIMITER_ORG_CONTEXT_ANSWER =
  'I can’t verify AI Help usage limits because your organization context is missing, ambiguous, or doesn’t match your session. Refresh the app or switch workspace, then try again.';

export type AiAssistantRateLimiterRpcFailureKind = 'org_context' | 'infra';

/** Classifies PostgREST/Postgres errors from `ai_assistant_check_rate_limit` (message text varies by gateway). */
export function classifyAiAssistantRateLimitRpcFailure(
  error: { message?: string; code?: string } | null | undefined,
): AiAssistantRateLimiterRpcFailureKind {
  const msg = (error?.message ?? '').toLowerCase();
  if (
    msg.includes('org_context_missing') ||
    msg.includes('org_context_ambiguous') ||
    msg.includes('org_context_mismatch')
  ) {
    return 'org_context';
  }
  return 'infra';
}
export const CALENDAR_KIND_FOLLOWUP_NEEDS_DATE_ANSWER =
  'Which date or period should I check?';
export const CALENDAR_DETAILS_LOAD_FAILED_ANSWER =
  'I couldn’t load the details for that visible calendar item right now. Please try again.';
export const DEFAULT_AI_ASSISTANT_RATE_LIMITS: AiAssistantRateLimits = {
  userHour: 20,
  userDay: 80,
  orgDay: 200,
};

export const MAX_CALENDAR_RANGE_DAYS = 31;
export const MAX_CALENDAR_DETAIL_LOOKBACK_DAYS = 90;
export const MAX_CALENDAR_RESULTS = 25;
export const MAX_MODEL_FACT_CANDIDATES = 5;
export const MAX_MODEL_SEARCH_CHARS = 80;
export const AI_ASSISTANT_CONTEXT_TTL_MS = 10 * 60 * 1000;
export const AI_ASSISTANT_CONTEXT_CLARIFICATION =
  'Which calendar item do you mean? Please tell me the item or date.';
export const CALENDAR_DETAIL_PRICING_REFUSAL =
  'I can’t answer pricing questions in the assistant yet. Please open the item directly in IndexCasting.';
export const CALENDAR_DETAIL_AMBIGUOUS_ANSWER =
  'Which calendar item do you mean? Please tell me the item or date.';

const FORBIDDEN_PATTERNS: Array<
  [
    Exclude<
      AssistantIntent,
      | 'help_static'
      | 'calendar_summary'
      | 'calendar_item_details'
      | 'model_visible_profile_facts'
      | 'model_calendar_availability_check'
    >,
    RegExp,
  ]
> = [
  ['cross_org', /\b(another|other|different|all)\s+(agency|agencies|client|clients|org|organization|company|companies)\b/i],
  ['cross_org', /\b(cross[-\s]?org|outside (my|our) (org|organization)|from another)\b/i],
  ['cross_org', /\b(all|every|export)\s+models?\b/i],
  ['cross_org', /\b(show|list|give|export)\s+(?:me\s+)?all\s+(?:data|records)\b/i],
  ['billing', /\b(billing|invoice|invoices|payment|payments|subscription|subscriptions|stripe|tax|vat|bank|payout|settlement|revenue|revenues|turnover)\b/i],
  ['billing', /\b(show|list|give|get)\b.*\b(prices?|pricing|rates?|fees?|budgets?)\b/i],
  ['gdpr_export_delete', /\b(gdpr|export (my|all|personal)|personal data export|delete (my )?account|account deletion|delete organization|dissolve organization)\b/i],
  ['team_management', /\b(invite|invitation|team member|team members|member list|members list|organization members|remove member|add member)\b/i],
  ['admin_security', /\b(admin|security|api key|secret|system prompt|developer instruction|policy|policies|permissions)\b/i],
  ['admin_security', /\b(ignore|override|forget)\b.*\b(previous rules|all rules|system instructions|developer instructions)\b/i],
  ['database_schema', /\b(service[_\s-]?role|sql|query the database|database|schema|table|tables|rpc|rls|migration|supabase internals?|internal ids?|org ids?|organization_?ids?|model_?ids?|uuids?|option_requests)\b|\bquery\b[\s\S]{0,80}\boption_requests\b/i],
  [
    'model_hidden_data',
    /\b(output|dump|export)\b[\s\S]{0,120}\b(hidden|private)\b[\s\S]{0,120}\bdata\b/i,
  ],
  [
    'raw_messages',
    /\b(raw messages?|chat history|message dump|all messages?|show .* messages?|what did (?![\s\S]{0,240}calendar item)[\s\S]{0,240}?\b(say|write|send))\b/i,
  ],
  ['model_hidden_data', /\b(hidden|private|invisible|not visible)\b.*\b(agency\s+)?models?\b/i],
  ['model_hidden_data', /\b(show|give|tell|list|what(?:'s| is)?)\b.*\b(emails?|e-mails?|phone|phone numbers?|private notes?|hidden notes?|admin notes?|private pictures?|private photos?|hidden pictures?|hidden photos?|raw storage|file urls?|storage paths?|mediaslide|sync id|internal ids?)\b/i],
  ['model_hidden_data', /\b(model email|model emails|email address|all models from|private model|private models|hidden model|hidden models|not visible model|invisible model)\b/i],
];

const LIVE_DATA_PATTERNS = [
  /\b(which|what|show|list|give me|tell me)\b.*\b(bookings?|options?|castings?|requests?|models?|organization|team|members?|projects?)\b/i,
  /\b(status)\b.*\b(my|our|this)\b.*\b(request|option|casting|booking|project)\b/i,
  /\b(available|availability)\b.*\b(today|tomorrow|this week|next week|now)\b/i,
  /\b(who)\b.*\b(organization|team|company|agency|client)\b/i,
  /\bwho\s+is\s+booked\b/i,
  /\bis\s+[a-z\p{L}\p{N}'’.\-\s]{2,80}\s+booked\b/iu,
  /\bwhen\s+is\s+[a-z\p{L}\p{N}'’.\-\s]{2,80}\s+working\b/iu,
  /\b(find|show|list)\s+bookings?\s+for\b/i,
];

/** Single-word calendar kind reply after assistant asked which kind/item. */
export const CALENDAR_KIND_ONLY_REPLY = /^\s*(job|casting|option|booking)s?\.?\s*$/i;

function isAvailabilityLikeMessage(message: string): boolean {
  return /\b(free|available|busy|booked|verf(ü|ue)gbar|verf(ü|ue)gbarkeit|frei|gebucht|zeit)\b/iu.test(
    message,
  );
}

/** Past-focused “last / latest …” calendar browse that collided with calendar_item_details (“last event”). */
export function isGlobalLastCalendarBrowseSummaryQuestion(message: string): boolean {
  const n = message.trim();
  const l = n.toLowerCase();
  if (!n || CALENDAR_KIND_ONLY_REPLY.test(n)) return false;
  if (isAvailabilityLikeMessage(n)) return false;
  if (/\b(next|upcoming)\b/i.test(l) && !/\b(last|latest|previous|letzte)\b/i.test(l)) return false;
  if (/\b(who|which)\b/i.test(l) && /\b(client|model|counterparty|agency)\b/i.test(l)) return false;

  if (
    /\bwhat\s+was\s+(?:the\s+)?last\s+event\s+in\s+(?:the\s+)?calendar\b/i.test(l) ||
    /\bwhat\s+was\s+my\s+last\s+calendar\s+event\b/i.test(l) ||
    /\b(last|latest)\s+calendar\s+event\b/i.test(l) ||
    /\b(last|latest)\s+calendar\s+item\b/i.test(l) ||
    /\b(last|latest)\s+event\b/i.test(l) ||
    /\blatest\s+entry\b/i.test(l) ||
    /\bwhat\s+happened\s+last\b/i.test(l) ||
    /\bwhat\s+did\s+i\s+have\s+last\b/i.test(l)
  ) {
    return true;
  }
  if (/\bletzte[rn]?\s+(event|termin|kalendereintrag|eintrag)\b/iu.test(n)) return true;
  return false;
}

export function isGlobalNextCalendarBrowseSummaryQuestion(message: string): boolean {
  const l = message.trim().toLowerCase();
  if (!l || isAvailabilityLikeMessage(l)) return false;
  return (
    /\bwhat\s+is\s+my\s+next\s+event\b/i.test(l) ||
    /\bnext\s+calendar\s+event\b/i.test(l) ||
    /\bupcoming\s+event\b/i.test(l)
  );
}

const CALENDAR_PATTERNS = [
  /\bcalendar\b/i,
  /\bwhat\s+(?:is|what's)\s+on\s+(?:my|our)?\s*calendar\b/i,
  /\bshow\s+(?:my|our)?\s*calendar\b/i,
  /\bwhat\s+(?:do\s+i|do\s+we)\s+have\b.*\b(today|tomorrow|this week|next week|next \d+ days?|soon|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b/i,
  /\bwhat\s+(?:bookings?|options?|castings?|jobs?|requests?)\s+do\s+(?:i|we)\s+have\b/i,
  /\bdo\s+(?:i|we)\s+have\s+any\s+(?:bookings?|options?|castings?|jobs?|requests?)\b/i,
  /\b(what|show|list|tell me|do i|do we|have|what's|what is|who)\b.*\b(today|tomorrow|this week|next week|next \d+ days?|month|soon|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b.*\b(options?|castings?|jobs?|bookings?|booked|requests?)\b/i,
  /\b(options?|castings?|jobs?|bookings?|booked|requests?)\b.*\b(today|tomorrow|this week|next week|next \d+ days?|month|soon|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b/i,
  /\bwhat (is|do we have|do i have).*\b(today|tomorrow|next week|this week|soon|upcoming|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b/i,
  /\bwhat\s+is\s+upcoming\b/i,
  /\bwhat\s+is\s+next\b/i,
  /\b(?:from|between)\s+\d{4}-\d{2}-\d{2}\s+(?:to|and|-)\s+\d{4}-\d{2}-\d{2}\b/i,
  /\bwhen\s+was\s+(?:my\s+)?(?:the\s+)?last\s+(?:job|booking|casting|option)\b/i,
  // German calendar tokens (minimal allowlist; intent only — date resolver
  // remains English-token driven and falls back to safe defaults).
  /\bkalender\b/iu,
  /\b(?:morgen|heute|n[äa]chste\s+woche|diese\s+woche|n[äa]chsten?\s+\d{1,3}\s+tage?)\b/iu,
  /\b(?:job|jobs|casting|castings|option|optionen|buchung|buchungen|termin|termine)\b.*\b(?:morgen|heute|n[äa]chste\s+woche|diese\s+woche|letzte\s+woche|am\s+\d{4}-\d{2}-\d{2})\b/iu,
  /\bletzte[rn]?\s+(?:job|buchung|casting|option)\b/iu,
];

const CALENDAR_DETAIL_PATTERNS = [
  /^\s*tell me more\.?\s*$/i,
  /^\s*give me details\.?\s*$/i,
  /^\s*(more\s+)?details\.?\s*$/i,
  /^\s*what\s+job\??\s*$/i,
  /\b(details?|more|tell me more)\b.*\b(that|this|last|job|booking|casting|option|calendar item|event)\b/i,
  // Avoid bare “last event” here — it catches global “what was the last event in the calendar” (calendar_summary).
  /\b(that|this)\s+(job|booking|casting|option|calendar item|event)\b/i,
  /\blast\s+(job|booking|casting|option|calendar item|event)\b/i,
  /\bwho\s+was\s+(?:the\s+)?(?:client|agency|counterparty)\??\s*$/i,
  /\bwho\s+was\s+(?:the\s+)?(?:client|agency|counterparty)\b.*\b(that|this|last|job|booking|casting|option)\b/i,
  /\bwho\s+was\s+it\s+with\b/i,
  /\bwhich\s+model\s+was\s+(?:booked|it|that)?\??\s*$/i,
  /\bwhich\s+model\b.*\b(that|this|last|job|booking|casting|option)\b/i,
  /\bwhat\s+time\s+was\s+(?:it|that|this)\??\s*$/i,
  /\bwhen\s+was\s+(?:it|that|this)\??\s*$/i,
  /\bwhen\s+was\s+(?:that|this|the\s+last)\s+(?:job|booking|casting|option|calendar item|event)\b/i,
  /\bwhere\s+was\s+(?:it|that|this)\??\s*$/i,
  /\bhow\s+long\s+(?:was|is)\s+(?:it|that|this)\??\s*$/i,
  /\bwhen\s+does\s+(?:it|that|this)\s+(?:start|end)\??\s*$/i,
  /\bwhat\s+was\s+(?:the\s+)?title\??\s*$/i,
  /\bwhat\s+was\s+(?:the\s+)?(?:description|notes?)\b/i,
  /\bwhat\s+were\s+(?:the\s+)?notes?\b/i,
  /\bwhat\s+did\s+that\s+calendar\s+item\s+say\b/i,
  // German follow-up phrasing for the most common variants only.
  /\bletzte[rn]?\s+(?:job|buchung|casting|option)\b/iu,
  /^\s*(?:wann\s+war\s+)?(?:der|die|das)?\s*letzte[rn]?\s+(?:job|buchung|casting|option)\??\s*$/iu,
];

const CALENDAR_DETAIL_PRICE_PATTERN =
  /\b(price|pricing|cost|fee|rate|budget|amount|how much|paid|pay)\b/i;

/** Model token: at least 3 chars to avoid matching "me" in "give me …". */
const MODEL_NAME_TOK = String.raw`\b\p{L}[\p{L}\p{N}]{2,63}\b`;

/** Optional 1–2 letter segment after full tokens (e.g. “Johann E measurements”, “Remi X waist”). */
const MODEL_NAME_OPTIONAL_INITIAL_SUFFIX = String.raw`(?:\s+\p{L}{1,2}\b)?`;

const MODEL_PROFILE_PATTERNS_FOLDED: RegExp[] = [
  new RegExp(
    `\\b(measurements?|dimensions?|maße|masse|messwerte|größe|grosse)\\b[\\s\\S]{0,120}\\b(?:of|for|von|für|fuer)\\b[\\s\\S]{0,120}${MODEL_NAME_TOK}(?:\\s+${MODEL_NAME_TOK}){0,3}`,
    'iu',
  ),
  new RegExp(
    `\\b(?:height|city|base|based|location|located|hair|eyes?|shoes?|shoe\\s+size|chest|bust|waist|hips|größe|grosse|taille|brust|hüfte|huefte|schuhe|haare|augen)\\b[\\s\\S]{0,120}\\b(?:of|for|does|is|has|have|von|für|fuer|ist|hat|haben)\\b[\\s\\S]{0,120}${MODEL_NAME_TOK}(?:\\s+${MODEL_NAME_TOK}){0,3}`,
    'iu',
  ),
  new RegExp(
    `\\b(?:what|show|tell\\s+me|give\\s+me)\\b[\\s\\S]{0,160}\\b(?:profile\\s+facts?|basic\\s+facts?|model\\s+facts?)\\b[\\s\\S]{0,120}${MODEL_NAME_TOK}(?:\\s+${MODEL_NAME_TOK}){0,3}`,
    'u',
  ),
  new RegExp(
    `\\bgive\\s+me\\b[\\s\\S]{0,120}\\bmodel\\s+data\\b[\\s\\S]{0,120}${MODEL_NAME_TOK}(?:\\s+${MODEL_NAME_TOK}){0,3}`,
    'u',
  ),
  new RegExp(
    `\\bdoes\\b[\\s\\S]{0,120}${MODEL_NAME_TOK}(?:\\s+${MODEL_NAME_TOK}){0,3}[\\s\\S]{0,120}\\bhave\\s+an\\s+account\\b`,
    'u',
  ),
  new RegExp(
    `\\bmodel\\s+dimensions?\\b[\\s\\S]{0,120}${MODEL_NAME_TOK}(?:\\s+${MODEL_NAME_TOK}){0,3}`,
    'u',
  ),
  /\bdo(?:es)?\b[\s\S]{0,120}\b(?:measurements?|dimensions?)\b[\s\S]{0,80}\bmatch\b/u,
  new RegExp(
    `\\bdoes\\b[\\s\\S]{0,120}${MODEL_NAME_TOK}(?:\\s+${MODEL_NAME_TOK}){0,3}[\\s\\S]{0,120}\\bmatch\\s+the\\s+system\\b`,
    'u',
  ),
  /\b(?:her|his|their)\s+(?:measurements?|dimensions?|height|city|location|shoes?|shoe\s+size|chest|bust|waist|hips|hair|eyes?)\b/iu,
  /\b(?:this|that)\s+model\b[\s\S]{0,120}\b(?:measurements?|dimensions?|height|city|location|shoes?|shoe\s+size|chest|bust|waist|hips|hair|eyes?|account)\b/iu,
  new RegExp(
    `${MODEL_NAME_TOK}(?:\\s+${MODEL_NAME_TOK}){0,3}${MODEL_NAME_OPTIONAL_INITIAL_SUFFIX}\\s+\\b(?:measurements?|dimensions?)\\b`,
    'u',
  ),
  new RegExp(
    `\\b(?:what|show|tell\\s+me|give\\s+me)\\b[\\s\\S]{0,40}\\b(?:are|is)\\b[\\s\\S]{0,120}${MODEL_NAME_TOK}(?:\\s+${MODEL_NAME_TOK}){0,3}${MODEL_NAME_OPTIONAL_INITIAL_SUFFIX}\\s+\\b(?:measurements?|dimensions?)\\b`,
    'u',
  ),
  new RegExp(
    `\\bshow\\b[\\s\\S]{0,40}${MODEL_NAME_TOK}(?:\\s+${MODEL_NAME_TOK}){0,3}${MODEL_NAME_OPTIONAL_INITIAL_SUFFIX}\\s+\\b(?:measurements?|dimensions?)\\b`,
    'u',
  ),
  new RegExp(
    `\\bwhat\\s+is\\b[\\s\\S]{0,120}${MODEL_NAME_TOK}(?:\\s+${MODEL_NAME_TOK}){0,3}${MODEL_NAME_OPTIONAL_INITIAL_SUFFIX}\\s+\\bheight\\b`,
    'u',
  ),
  new RegExp(
    `${MODEL_NAME_TOK}(?:\\s+${MODEL_NAME_TOK}){0,3}${MODEL_NAME_OPTIONAL_INITIAL_SUFFIX}\\s+\\b(?:waist|chest|hips|height)\\b`,
    'u',
  ),
  new RegExp(
    `${MODEL_NAME_TOK}(?:\\s+${MODEL_NAME_TOK}){0,3}${MODEL_NAME_OPTIONAL_INITIAL_SUFFIX}\\s+model\\s+size\\b`,
    'u',
  ),
  new RegExp(
    `\\bwhat\\s+is\\b[\\s\\S]{0,120}${MODEL_NAME_TOK}(?:\\s+${MODEL_NAME_TOK}){0,3}${MODEL_NAME_OPTIONAL_INITIAL_SUFFIX}\\s+model\\s+size\\b`,
    'u',
  ),
  new RegExp(
    `\\bwhat\\s+are\\b[\\s\\S]{0,40}${MODEL_NAME_TOK}(?:\\s+\\p{L}{1,4}){0,2}\\s+\\bmeasurements?\\b`,
    'u',
  ),
  new RegExp(
    `\\bis\\b[\\s\\S]{0,40}${MODEL_NAME_TOK}(?:\\s+${MODEL_NAME_TOK}){0,3}[\\s\\S]{0,40}\\bcm\\b`,
    'iu',
  ),
];

const MODEL_INFO_CLARIFICATION_PATTERN =
  /^\s*what\s+about\s+([a-z\p{L}\p{N}'’.\-\s]{2,80})\??\s*$/iu;

const WRITE_ACTION_PATTERN =
  /^(please\s+)?(create|add|book|confirm|cancel|delete|remove|update|send|invite|change)\b|\b(create|add|book|confirm|cancel|delete|remove|update|send|invite|change)\b.*\b(for me|now|today|tomorrow|next week|to\s+\d+)\b/i;

const POLITE_CAPABILITY_QUESTION =
  /^\s*(can|could|may|would|should)\s+(i|we)\b/i;

const MODEL_CALENDAR_FOREVER_RANGE_PATTERN =
  /\b(all|entire|every|whole|forever|lifetime)\b.*\bcalendar\b|\bcalendar\b.*\b(all|entire|every|forever|whole)\b|\bshow\s+all\s+(?:of\s+)?/i;

function positiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function daysBetweenInclusive(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

function dateFromDateOnly(value: string): Date | null {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed);
}

const WEEKDAY_TO_UTC_DAY: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function nextWeekdayDate(today: Date, weekday: number): Date {
  const diff = (weekday - today.getUTCDay() + 7) % 7;
  return addDays(today, diff);
}

function mondayOfUtcWeek(d: Date): Date {
  const dow = d.getUTCDay();
  const daysSinceMonday = (dow + 6) % 7;
  return addDays(d, -daysSinceMonday);
}

function weekdayDateThisWeek(today: Date, weekday: number): Date {
  const monday = mondayOfUtcWeek(today);
  const offset = weekday === 0 ? 6 : weekday - 1;
  return addDays(monday, offset);
}

/** “Next weekday”: upcoming occurrence; if this weekday’s calendar date is behind today, use +7 days. */
function resolveNextLabelledWeekday(today: Date, weekday: number): string {
  const thisWeek = weekdayDateThisWeek(today, weekday);
  if (dateOnly(thisWeek) > dateOnly(today)) return dateOnly(thisWeek);
  if (dateOnly(thisWeek) === dateOnly(today)) return dateOnly(addDays(thisWeek, 7));
  return dateOnly(addDays(thisWeek, 7));
}

/** “This weekday”: same ISO week only; if that day is already before today, ambiguous at caller. */
function resolveThisLabelledWeekday(today: Date, weekday: number): string | null {
  const thisWeek = weekdayDateThisWeek(today, weekday);
  if (dateOnly(thisWeek) < dateOnly(today)) return null;
  return dateOnly(thisWeek);
}

const MONTH_NAME_TO_NUM: Record<string, number> = {
  january: 1,
  jan: 1,
  januar: 1,
  february: 2,
  feb: 2,
  februar: 2,
  march: 3,
  mar: 3,
  märz: 3,
  maerz: 3,
  april: 4,
  apr: 4,
  may: 5,
  mai: 5,
  june: 6,
  jun: 6,
  juni: 6,
  july: 7,
  jul: 7,
  juli: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  oktober: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
  dezember: 12,
  dez: 12,
};

export type AvailabilityDateResolution =
  | { kind: 'ok'; date: string }
  | { kind: 'missing' }
  | { kind: 'ambiguous' };

function parseMonthNameDay(message: string, now: Date): AvailabilityDateResolution | null {
  const lower = message.toLowerCase();
  const yearMatch = lower.match(/\b(\d{4})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : now.getUTCFullYear();

  const monthFirst = lower.match(
    /\b(january|januar|jan|february|februar|feb|march|märz|maerz|mar|april|apr|may|mai|june|juni|jun|july|juli|jul|august|aug|september|sep|sept|october|oktober|oct|november|nov|december|dezember|dez)\s+(\d{1,2})(?:st|nd|rd|th)?\b/,
  );
  if (monthFirst?.[1] && monthFirst[2]) {
    const monthNum = MONTH_NAME_TO_NUM[monthFirst[1]];
    const dayNum = Number(monthFirst[2]);
    if (!monthNum || !Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31) return null;
    const candidate = new Date(Date.UTC(year, monthNum - 1, dayNum));
    if (candidate.getUTCMonth() !== monthNum - 1 || candidate.getUTCDate() !== dayNum) {
      return { kind: 'ambiguous' };
    }
    return { kind: 'ok', date: dateOnly(candidate) };
  }

  const dayFirst = lower.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|januar|jan|february|februar|feb|march|märz|maerz|mar|april|apr|may|mai|june|juni|jun|july|juli|jul|august|aug|september|sep|sept|october|oktober|oct|november|nov|december|dezember|dez)\b/,
  );
  if (dayFirst?.[1] && dayFirst[2]) {
    const dayNum = Number(dayFirst[1]);
    const monthNum = MONTH_NAME_TO_NUM[dayFirst[2]];
    if (!monthNum || !Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31) return null;
    const candidate = new Date(Date.UTC(year, monthNum - 1, dayNum));
    if (candidate.getUTCMonth() !== monthNum - 1 || candidate.getUTCDate() !== dayNum) {
      return { kind: 'ambiguous' };
    }
    return { kind: 'ok', date: dateOnly(candidate) };
  }

  return null;
}

function messageHasImplicitAvailabilityDate(message: string): boolean {
  const lower = message.toLowerCase();
  if (/\b(\d{4}-\d{2}-\d{2})\b/.test(message)) return true;
  if (lower.includes('today') || lower.includes('tomorrow') || /\bmorgen\b/iu.test(message)) return true;
  if (/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(lower)) return true;
  if (
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|januar|februar|märz|maerz|mai|juni|juli|oktober|dezember)\b/i.test(
      lower,
    )
  ) {
    return true;
  }
  return false;
}

export function resolveAvailabilityCheckDate(
  message: string,
  now = new Date(),
  assistantContext: AiAssistantContext | null = null,
): AvailabilityDateResolution {
  const normalized = message.trim();
  const lower = normalized.toLowerCase();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const isoMatch = normalized.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch?.[1]) {
    const d = dateFromDateOnly(isoMatch[1]);
    if (d) return { kind: 'ok', date: isoMatch[1] };
    return { kind: 'ambiguous' };
  }

  const usEu = normalized.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/);
  if (usEu) {
    const a = Number(usEu[1]);
    const b = Number(usEu[2]);
    const yRaw = usEu[3] ? Number(usEu[3]) : now.getUTCFullYear();
    const y = yRaw < 100 ? 2000 + yRaw : yRaw;
    if (a <= 12 && b <= 12 && a !== b && !usEu[3]) {
      return { kind: 'ambiguous' };
    }
    const dayFirst = b <= 12 && a > 12;
    const day = dayFirst ? a : b > 12 ? b : a;
    const month = dayFirst ? b : b > 12 ? a : b;
    if (month < 1 || month > 12 || day < 1 || day > 31) return { kind: 'ambiguous' };
    const candidate = new Date(Date.UTC(y, month - 1, day));
    if (candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
      return { kind: 'ambiguous' };
    }
    return { kind: 'ok', date: dateOnly(candidate) };
  }

  const monthParsed = parseMonthNameDay(normalized, now);
  if (monthParsed) return monthParsed;

  if (lower.includes('tomorrow') || /\bmorgen\b/iu.test(normalized)) {
    return { kind: 'ok', date: dateOnly(addDays(today, 1)) };
  }
  if (lower.includes('today') || /\bheute\b/iu.test(normalized)) {
    return { kind: 'ok', date: dateOnly(today) };
  }

  const nextWeekdayMatch = lower.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (nextWeekdayMatch?.[1]) {
    const w = WEEKDAY_TO_UTC_DAY[nextWeekdayMatch[1]];
    return { kind: 'ok', date: resolveNextLabelledWeekday(today, w) };
  }

  const thisWeekdayMatch = lower.match(/\bthis\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (thisWeekdayMatch?.[1]) {
    const w = WEEKDAY_TO_UTC_DAY[thisWeekdayMatch[1]];
    const resolved = resolveThisLabelledWeekday(today, w);
    if (!resolved) return { kind: 'ambiguous' };
    return { kind: 'ok', date: resolved };
  }

  const plainWeekdayMatch = lower.match(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  );
  if (plainWeekdayMatch?.[1] && !/\b(next|this)\s+/i.test(lower)) {
    const w = WEEKDAY_TO_UTC_DAY[plainWeekdayMatch[1]];
    return { kind: 'ok', date: dateOnly(nextWeekdayDate(today, w)) };
  }

  if (
    /\b(that|the)\s+day\b/i.test(normalized) &&
    assistantContext &&
    isAssistantContextValid(assistantContext, now) &&
    assistantContext.last_intent === 'model_calendar_availability_check' &&
    assistantContext.last_availability_date_source === 'single_day_resolve' &&
    typeof assistantContext.last_availability_check_date === 'string'
  ) {
    return { kind: 'ok', date: assistantContext.last_availability_check_date };
  }

  if (
    /\bnext\s+week\b/i.test(lower) ||
    /\bthis\s+week\b/i.test(lower) ||
    /\bnext\s+month\b/i.test(lower) ||
    /\bn[äa]chste\s+woche\b/iu.test(lower) ||
    /\bdiese\s+woche\b/iu.test(lower)
  ) {
    return { kind: 'missing' };
  }

  if (
    assistantContext &&
    isAssistantContextValid(assistantContext, now) &&
    assistantContext.last_intent === 'model_calendar_availability_check' &&
    assistantContext.last_availability_date_source === 'single_day_resolve' &&
    typeof assistantContext.last_availability_check_date === 'string' &&
    /^\s*what\s+about\b/i.test(normalized)
  ) {
    return { kind: 'ok', date: assistantContext.last_availability_check_date };
  }

  return { kind: 'missing' };
}

function stripModelAvailabilityNoise(value: string): string {
  return stripModelSearchNoise(value)
    .replace(
      /\b(free|available|availability|busy|blocked|conflict|booked|calendar|check|tomorrow|today|next|this|time|anything|something|already|still|use|does|did|have|has|is|are|will|can|could|may|would|should|there|already|casting|castings|option|options|booking|bookings|job|jobs|about|with|for|on|at|in|the|a|an|verfügbarkeit|verfuegbarkeit|verfügbar|verfuegbar|frei|zeit|gebucht|kalender|morgen|heute|hat|ist|haben|bereits)\b/giu,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MODEL_SEARCH_CHARS);
}

export function extractModelAvailabilitySearchText(message: string): string {
  const collapsed = collapseInitialPossessiveEsBeforeModelFactTail(message);
  return normalizeSearchTextArtifacts(stripModelAvailabilityNoise(collapsed)).slice(
    0,
    MAX_MODEL_SEARCH_CHARS,
  );
}

function isPronounAvailabilityQuestion(message: string): boolean {
  return (
    /\b(?:is|are|will|does|do)\s+(?:he|she|they)\b[\s\S]{0,80}\b(?:free|available|busy|blocked|anything|something|time|casting|booking|job|option)\b/iu.test(
      message,
    ) ||
    /\b(?:is|are)\s+(?:he|she|they)\s+(?:free|available|busy|blocked)\b/iu.test(message)
  );
}

function hasModelCalendarAvailabilitySignal(message: string, folded: string): boolean {
  const m = message;
  return (
    /\b(?:free|available|availability|busy|blocked|conflict|booked)\b/iu.test(m) ||
    /\b(?:verfügbar|verfuegbar|verfügbarkeit|verfuegbarkeit|frei|gebucht|zeit|kalender|termin)\b/iu.test(
      folded,
    ) ||
    /\b(?:can|could|may)\s+(?:i|we)\s+(?:book|option|use)\b/i.test(m) ||
    /\bhave\s+(?:anything|something|time|a\s+(?:casting|job|booking|option))\b/i.test(m) ||
    /\bhas\s+(?:anything|something|a\s+(?:casting|job|booking|option))\b/i.test(m) ||
    /\b(?:anything|something)\b[\s\S]{0,40}\b(?:on|for|scheduled|that\s+day)\b/i.test(m) ||
    /\bcould\b[\s\S]{0,120}\b(?:do|make)\b[\s\S]{0,80}\b(?:casting|job|booking|option)\b/i.test(m) ||
    /\bwhat\b[\s\S]{0,80}\b(?:does|do|is|about)\b[\s\S]{0,120}\bhave\b/i.test(m) ||
    /\bwhat\b[\s\S]{0,40}\b(?:does|do)\b[\s\S]{0,120}\b(?:calendar|kalender)\b/i.test(m) ||
    /\bcheck\b[\s\S]{0,80}\bon\b/i.test(m) ||
    /\bhat\s+[A-ZÄÖÜa-zäöüß][\p{L}\p{N}'’.\-\s]{0,48}\b(?:morgen|heute|frei|zeit|kalender|gebucht|verfügbar|verfuegbar)\b/iu.test(
      m,
    ) ||
    /\bist\s+[A-ZÄÖÜa-zäöüß][\p{L}\p{N}'’.\-\s]{0,48}\b(?:morgen|heute|frei|zeit|kalender|gebucht|verfügbar|verfuegbar)\b/iu.test(
      m,
    ) ||
    /\bwhat\s+about\b[\s\S]{0,200}\b(?:on|for)\b[\s\S]{0,120}\b(?:\d{4}-\d{2}-\d{2}|may\s+\d{1,2}|january|february|march|april|june|july|august|september|october|november|december)\b/i.test(
      m,
    )
  );
}

function hasBareAgencyCalendarSummaryShape(message: string): boolean {
  if (!CALENDAR_PATTERNS.some((pattern) => pattern.test(message))) return false;
  const st = extractModelAvailabilitySearchText(message);
  if (
    st.length >= 2 &&
    !isDenylistOnlyModelSearchName(st) &&
    hasPlausibleModelNameToken(st)
  ) {
    return false;
  }
  return true;
}

/** Phrases that are org-wide calendar summaries but may not match every CALENDAR_PATTERNS entry. */
function looksLikeOrgCalendarSummaryPhrase(message: string): boolean {
  const lower = message.toLowerCase();
  if (
    /\bwas\s+habe\s+ich\b/iu.test(message) &&
    /\bpor\s+favor\b/i.test(message)
  ) {
    return false;
  }
  if (/\bwhat\s+is\s+booked\b/i.test(message) && /\b\d{4}-\d{2}-\d{2}\b/.test(message)) return true;
  if (/\bwhat\b[\s\S]{0,44}\bdo\s+(?:i|we)\s+have\b/i.test(message)) return true;
  if (
    /\bwho\s+is\s+booked\b/i.test(lower) &&
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|\d{4}-\d{2}-\d{2})\b/i.test(
      lower,
    )
  ) {
    return true;
  }
  if (/\bwhat\s+jobs\s+do\s+we\s+have\b/i.test(lower)) return true;
  if (/\bwas\s+habe\s+ich\b/iu.test(message)) return true;
  if (/\bhabe\s+ich\s+jobs?\b/iu.test(lower)) return true;
  if (/\bkalender\s+heute\b/iu.test(lower)) return true;
  if (/was\s+steht\s+im\s+kalender\b/iu.test(lower)) return true;
  return false;
}

function classifyModelCalendarAvailabilityIntent(
  message: string,
  role: ViewerRole,
  folded: string,
  assistantContext: AiAssistantContext | null,
  now: Date,
): IntentClassification | null {
  if (role !== 'agency' && role !== 'client' && role !== 'model') return null;

  const ctxModel =
    assistantContext &&
    isAssistantContextValid(assistantContext, now) &&
    typeof assistantContext.last_model_name === 'string'
      ? assistantContext.last_model_name.trim()
      : '';
  const ctxAvailDate =
    assistantContext &&
    isAssistantContextValid(assistantContext, now) &&
    assistantContext.last_intent === 'model_calendar_availability_check' &&
    assistantContext.last_availability_date_source === 'single_day_resolve' &&
    typeof assistantContext.last_availability_check_date === 'string'
      ? assistantContext.last_availability_check_date
      : '';

  const whatAboutAvail = message.match(MODEL_INFO_CLARIFICATION_PATTERN);
  if (whatAboutAvail?.[1] && ctxAvailDate) {
    const searchText = normalizeSearchTextArtifacts(
      stripModelAvailabilityNoise(whatAboutAvail[1]),
    ).slice(0, MAX_MODEL_SEARCH_CHARS);
    if (
      searchText.length >= 2 &&
      !isDenylistOnlyModelSearchName(searchText) &&
      hasPlausibleModelNameToken(searchText)
    ) {
      return {
        intent: 'model_calendar_availability_check',
        searchText,
        checkDate: ctxAvailDate,
      };
    }
  }

  if (hasBareAgencyCalendarSummaryShape(message)) return null;

  if (!hasModelCalendarAvailabilitySignal(message, folded)) return null;

  if (
    MODEL_CALENDAR_FOREVER_RANGE_PATTERN.test(message) &&
    /\b(?:calendar|kalender)\b/iu.test(message)
  ) {
    return { intent: 'unknown_live_data' };
  }

  const dateRes = resolveAvailabilityCheckDate(message, now, assistantContext);
  if (dateRes.kind === 'ambiguous') {
    return {
      intent: 'model_calendar_availability_check',
      searchText: '',
      dateAmbiguous: true,
    };
  }

  let checkDate: string | undefined = dateRes.kind === 'ok' ? dateRes.date : undefined;

  let searchText = extractModelAvailabilitySearchText(message);
  const pronoun = isPronounAvailabilityQuestion(message);

  if (pronoun) {
    if (ctxModel.length >= 2) {
      searchText = ctxModel;
    } else {
      return {
        intent: 'model_calendar_availability_check',
        searchText: '',
        checkDate,
        needsModelClarification: true,
        ...(checkDate ? {} : { needsDateClarification: true }),
      };
    }
  }

  const nameOk =
    searchText.length >= 2 &&
    !isDenylistOnlyModelSearchName(searchText) &&
    hasPlausibleModelNameToken(searchText);

  if (!nameOk) {
    if (ctxModel.length >= 2) {
      searchText = ctxModel;
    } else {
      return null;
    }
  }

  if (!checkDate) {
    return {
      intent: 'model_calendar_availability_check',
      searchText,
      needsDateClarification: true,
    };
  }

  return {
    intent: 'model_calendar_availability_check',
    searchText,
    checkDate,
  };
}

/**
 * Typing/layout variant where the possessive “’s” is split: “Remi Lovisolo s measurements”.
 * Fold away the lone “s” only when it sits immediately before visible-model-fact tail words
 * (intent matching + search extraction; does not broaden answered fields).
 */
const SEPARATED_POSSESSIVE_S_BEFORE_MODEL_FACT_TAIL =
  /\s+\bs\b\s+(?=(?:measurements?|dimensions?|height|waist|chest|hips|bust|hair|eyes?|shoes?|shoe\s+size|model\s+size|profile\s+facts?|basic\s+facts?|model\s+facts?|maße|masse|messwerte|größe|grosse|taille|brust|hüfte|huefte|schuhe|schuhgröße|schuhgroesse|haare|augen)\b)/giu;

export function normalizeSeparatedPossessiveSTokenForModelFacts(input: string): string {
  return input.replace(SEPARATED_POSSESSIVE_S_BEFORE_MODEL_FACT_TAIL, ' ');
}

/**
 * Typo/layout: “Aram Es waist” / merged initial possessive (“E” + “s”) before fact tails.
 */
const INITIAL_POSSESSIVE_ES_BEFORE_MODEL_FACT_TAIL =
  /\b(\p{L}{2,})\s+(\p{L})s\b(?=\s+(?:measurements?|dimensions?|height|waist|chest|hips|bust|hair|eyes?|shoes?|shoe\s+size|model\s+size|profile\s+facts?|basic\s+facts?|model\s+facts?|maße|masse|messwerte|größe|grosse|taille|brust|hüfte|huefte|schuhe|schuhgröße|schuhgroesse|haare|augen)\b)/giu;

export function collapseInitialPossessiveEsBeforeModelFactTail(input: string): string {
  return input.replace(INITIAL_POSSESSIVE_ES_BEFORE_MODEL_FACT_TAIL, '$1 $2');
}

/** Stopwords / measurement tokens that must not lose a trailing “s” during fuzzy name cleanup. */
const MODEL_SEARCH_TRAILING_S_NO_STRIP = new Set([
  'his',
  'hers',
  'theirs',
  'this',
  'that',
  'these',
  'those',
  'yes',
  'us',
  'as',
  'is',
  'was',
  'has',
  'measurements',
  'measurement',
  'dimensions',
  'dimension',
  'models',
  'model',
  'hips',
  'shoes',
  'eyes',
  'jones',
  'james',
  'chris',
  'alexis',
  'paris',
  'dallas',
  'lucas',
  'iris',
]);

const MODEL_SEARCH_MEASUREMENT_LEXEMES = new Set([
  'measurements',
  'measurement',
  'dimensions',
  'dimension',
  'height',
  'waist',
  'chest',
  'hips',
  'shoes',
  'shoe',
  'hair',
  'eyes',
  'eye',
  'model',
  'size',
  'data',
  'facts',
  'account',
  'accounts',
  'basic',
  'profile',
  'give',
  'tell',
  'what',
  'show',
  'does',
  'match',
  'system',
  'have',
  'the',
  'are',
  'for',
  'of',
  'me',
  'please',
  'a',
  'an',
  'and',
  'or',
  // Minimal German equivalents — measurement lexemes only (so the name extractor
  // strips them from the search text). No new field exposure; routing only.
  'maße',
  'masse',
  'messwerte',
  'größe',
  'grosse',
  'taille',
  'brust',
  'hüfte',
  'huefte',
  'schuhe',
  'schuhgröße',
  'schuhgroesse',
  'haare',
  'augen',
  'von',
  'der',
  'die',
  'das',
  'ist',
  'hat',
  'haben',
  'zeig',
  'zeige',
  'zeigen',
  'sind',
  'wie',
  'gross',
  'groß',
]);

/**
 * Lowercase, strip punctuation, normalize ascii apostrophe possessives and common “extra s” typos
 * (e.g. lovisolos → lovisolo) for model measurement intent matching only.
 */
export function normalizeTextForModelIntentMatching(message: string): string {
  let s = message.trim().normalize('NFKC').toLowerCase();
  s = collapseInitialPossessiveEsBeforeModelFactTail(s);
  s = normalizeSeparatedPossessiveSTokenForModelFacts(s);
  s = s.replace(/\b(\p{L}+)['\u2019]s\b/gu, '$1');
  s = s.replace(/[^\p{L}\p{N}\s]+/gu, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return normalizeModelNamePluralArtifacts(s);
}

/** Tokens that match MODEL_NAME_TOK shape but are not plausible display names (fail-closed for routing). */
const MODEL_SEARCH_NAME_DENYLIST = new Set([
  'the',
  'our',
  'your',
  'my',
  'all',
  'any',
  'and',
  'for',
  'not',
  'you',
  'she',
  'her',
  'his',
  'him',
  'its',
  'it',
  'who',
  'why',
  'how',
  'are',
  'was',
  'but',
  'did',
  'does',
  'has',
  'have',
]);

function isDenylistOnlyModelSearchName(searchText: string): boolean {
  const parts = searchText
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return true;
  return parts.every((p) => MODEL_SEARCH_NAME_DENYLIST.has(p));
}

/** True when at least one token looks like a name, not only measurement/stop words (prevents lone "size" / "our size"). */
function hasPlausibleModelNameToken(searchText: string): boolean {
  const parts = searchText
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return false;
  return parts.some(
    (p) => !MODEL_SEARCH_MEASUREMENT_LEXEMES.has(p) && !MODEL_SEARCH_NAME_DENYLIST.has(p),
  );
}

function normalizeModelNamePluralArtifacts(s: string): string {
  const words = s.split(' ').filter(Boolean);
  const out = words.map((w, i) => {
    if (MODEL_SEARCH_MEASUREMENT_LEXEMES.has(w) || MODEL_SEARCH_TRAILING_S_NO_STRIP.has(w)) return w;
    const next = words[i + 1] ?? '';
    const nextIsMeas =
      MODEL_SEARCH_MEASUREMENT_LEXEMES.has(next) || (next === 'size' && words[i - 1] === 'model');
    if (w.length >= 8 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    if (
      nextIsMeas &&
      w.length >= 4 &&
      w.length <= 7 &&
      w.endsWith('s') &&
      !w.endsWith('ss') &&
      /[aeiouyäöü]/u.test(w[w.length - 2] ?? '')
    ) {
      return w.slice(0, -1);
    }
    return w;
  });
  return out.join(' ');
}

function normalizeSearchTextArtifacts(text: string, measurementContextTail?: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const tailLow = measurementContextTail?.normalize('NFKC').toLowerCase().trim();
  const evalWords = tailLow ? [...words, tailLow] : words;
  const out = words.map((w, i) => {
    const low = w.normalize('NFKC').toLowerCase();
    if (MODEL_SEARCH_MEASUREMENT_LEXEMES.has(low) || MODEL_SEARCH_TRAILING_S_NO_STRIP.has(low)) {
      return w;
    }
    const nextWord = evalWords[i + 1] ?? '';
    const nextLow = nextWord.normalize('NFKC').toLowerCase();
    const nextIsMeas =
      MODEL_SEARCH_MEASUREMENT_LEXEMES.has(nextLow) ||
      (nextLow === 'size' &&
        i > 0 &&
        evalWords[i - 1]?.normalize('NFKC').toLowerCase() === 'model');
    let stemLow = low;
    if (stemLow.length >= 8 && stemLow.endsWith('s') && !stemLow.endsWith('ss')) {
      stemLow = stemLow.slice(0, -1);
    } else if (
      nextIsMeas &&
      stemLow.length >= 4 &&
      stemLow.length <= 7 &&
      stemLow.endsWith('s') &&
      !stemLow.endsWith('ss') &&
      /[aeiouyäöü]/u.test(stemLow[stemLow.length - 2] ?? '')
    ) {
      stemLow = stemLow.slice(0, -1);
    }
    if (stemLow === low) return w;
    if (w === w.toUpperCase()) return stemLow.toUpperCase();
    if (w.length > 0 && w[0] === w[0].toUpperCase() && w.slice(1) === w.slice(1).toLowerCase()) {
      return stemLow.charAt(0).toUpperCase() + stemLow.slice(1);
    }
    return stemLow;
  });
  return out.join(' ');
}

function extractFromTrailingMeasurementContext(raw: string): string | null {
  const folded = normalizeSeparatedPossessiveSTokenForModelFacts(raw);
  const re = /\b(?:measurements?|dimensions?|height|waist|chest|hips|model\s+size)\b/gi;
  let lastIdx = -1;
  let lastMatch = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(folded)) !== null) {
    const after = folded.slice(m.index + m[0].length);
    if (/^\s*(?:of|for)\s+\p{L}/u.test(after)) continue;
    lastIdx = m.index;
    lastMatch = m[0];
  }
  if (lastIdx === -1) return null;
  const prefix = folded.slice(0, lastIdx);
  const cleaned = stripModelSearchNoise(prefix);
  const tailToken =
    lastMatch
      .toLowerCase()
      .normalize('NFKC')
      .trim()
      .split(/\s+/)
      .pop() ?? 'measurements';
  const shaped = normalizeSearchTextArtifacts(cleaned, tailToken);
  return shaped.length >= 2 ? shaped : null;
}

function stripModelSearchNoise(value: string): string {
  return normalizeSeparatedPossessiveSTokenForModelFacts(value)
    .replace(/\b(what|are|is|the|of|for|model|show|me|tell|give|basic|profile|facts|data|does|have|an|account|height|measurements?|dimensions?|city|base|based|location|located|hair|eyes?|shoes?|shoe\s+size|chest|bust|waist|hips|here|received|match|system|compare|against|with|in|on|my|our|visible)\b/giu, ' ')
    // Minimal German equivalents (routing only).
    .replace(
      /\b(maße|masse|messwerte|größe|grosse|taille|brust|hüfte|huefte|schuhe|schuhgröße|schuhgroesse|haare|augen|von|der|die|das|ist|hat|haben|zeig|zeige|zeigen|sind|wie|gross|groß|für|fuer|nach|am|im|in)\b/giu,
      ' ',
    )
    .replace(/\b\d+(?:[.,]\d+)?\b/g, ' ')
    .replace(/[?:;,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MODEL_SEARCH_CHARS);
}

function resolveCalendarDetailRequestedField(message: string): CalendarDetailRequestedField {
  if (CALENDAR_DETAIL_PRICE_PATTERN.test(message)) return 'pricing';
  if (/\bwhat\s+did\s+that\s+calendar\s+item\s+say\b/i.test(message)) return 'description';
  if (/\bwhich\s+model\b|\bmodel\b.*\b(in|for)\b/i.test(message)) return 'model';
  if (/\b(client|agency|counterparty|who\s+was\s+it\s+with|who\s+was\s+.*with)\b/i.test(message)) {
    return 'counterparty';
  }
  if (/\bwhen|date|time|start|end|how\s+long\b/i.test(message)) return 'date';
  if (/\b(description|notes?)\b/i.test(message)) return 'description';
  return 'summary';
}

function resolveCalendarDetailReference(message: string): 'followup' | 'last_job' {
  if (/\blast\s+job\b/i.test(message)) return 'last_job';
  if (/\blast\s+(casting|option|booking)\b/i.test(message)) return 'last_job';
  if (/\blast\s+(calendar\s+)?(event|item|entry)\b/i.test(message)) return 'last_job';
  if (/\bletzte[rn]?\s+(?:job|buchung|casting|option)\b/iu.test(message)) return 'last_job';
  return 'followup';
}

function resolveCalendarDetailKindHint(message: string): CalendarSummaryItem['kind'] | undefined {
  if (/\bcasting\b/i.test(message)) return 'casting';
  if (/\boption\b/i.test(message)) return 'option';
  if (/\bjob\b/i.test(message)) return 'job';
  if (/\bbooking\b/i.test(message) || /\bbuchung\b/iu.test(message)) return 'booking';
  if (/\bprivate\s+event\b/i.test(message) || /\bprivat(?:er)?\s+termin\b/iu.test(message))
    return 'private_event';
  return undefined;
}

function isPronounModelFactsQuestion(message: string): boolean {
  return (
    /\b(?:her|his|their)\s+(?:measurements?|dimensions?|height|city|location|shoes?|shoe\s+size|chest|bust|waist|hips|hair|eyes?)\b/iu.test(
      message,
    ) ||
    /\b(?:this|that)\s+model\b.*\b(?:measurements?|dimensions?|height|city|location|shoes?|shoe\s+size|chest|bust|waist|hips|hair|eyes?|account)\b/iu.test(
      message,
    )
  );
}

export function extractModelProfileSearchText(message: string): string {
  const normalized = normalizeSeparatedPossessiveSTokenForModelFacts(
    collapseInitialPossessiveEsBeforeModelFactTail(message.replace(/\s+/g, ' ').trim()),
  );
  const bracketMatch = normalized.match(/\[([^\]]{2,80})\]/);
  if (bracketMatch?.[1]) {
    return normalizeSearchTextArtifacts(bracketMatch[1].trim()).slice(0, MAX_MODEL_SEARCH_CHARS);
  }

  const possessiveMatch = normalized.match(/\b([A-Z][\p{L}\p{N}'’.\-]*(?:\s+[A-Z][\p{L}\p{N}'’.\-]*){0,3})['’]s\b/u);
  if (possessiveMatch?.[1]) {
    return normalizeSearchTextArtifacts(possessiveMatch[1].trim()).slice(0, MAX_MODEL_SEARCH_CHARS);
  }

  const possessiveLower = normalized.match(
    /\b([a-z\p{L}][\p{L}\p{N}'’.\-]*(?:\s+[a-z\p{L}][\p{L}\p{N}'’.\-]*){0,3})['’]s\b/iu,
  );
  if (possessiveLower?.[1]) {
    return normalizeSearchTextArtifacts(possessiveLower[1].trim()).slice(0, MAX_MODEL_SEARCH_CHARS);
  }

  const namedAfterPreposition = normalized.match(/\b(?:of|for)\s+([A-Z][\p{L}\p{N}'’.\-]*(?:\s+[A-Z][\p{L}\p{N}'’.\-]*){0,3})\b/u);
  if (namedAfterPreposition?.[1]) {
    return normalizeSearchTextArtifacts(namedAfterPreposition[1].trim()).slice(0, MAX_MODEL_SEARCH_CHARS);
  }

  const namedAfterForLower = normalized.match(/\b(?:of|for)\s+([a-z][\p{L}\p{N}'’.\-]*(?:\s+[a-z][\p{L}\p{N}'’.\-]*){0,3})\b/iu);
  if (namedAfterForLower?.[1]) {
    return normalizeSearchTextArtifacts(stripModelSearchNoise(namedAfterForLower[1])).slice(
      0,
      MAX_MODEL_SEARCH_CHARS,
    );
  }

  const trailing = extractFromTrailingMeasurementContext(normalized);
  if (trailing) return trailing.slice(0, MAX_MODEL_SEARCH_CHARS);

  return normalizeSearchTextArtifacts(stripModelSearchNoise(normalized)).slice(0, MAX_MODEL_SEARCH_CHARS);
}

export function buildModelInfoClarificationAnswer(searchText: string): string {
  const safeName = cleanString(searchText, 80);
  return safeName
    ? `${MODEL_INFO_CLARIFICATION_PREFIX} ${safeName}? For example: measurements, height, location, hair, eyes, categories, or account status.`
    : 'What model information do you need? For example: measurements, height, location, hair, eyes, categories, or account status.';
}

export function resolveAiAssistantRateLimits(row?: Partial<{
  user_hour_limit: unknown;
  user_day_limit: unknown;
  org_day_limit: unknown;
}> | null): AiAssistantRateLimits {
  return {
    userHour: positiveInt(row?.user_hour_limit) ?? DEFAULT_AI_ASSISTANT_RATE_LIMITS.userHour,
    userDay: positiveInt(row?.user_day_limit) ?? DEFAULT_AI_ASSISTANT_RATE_LIMITS.userDay,
    orgDay: positiveInt(row?.org_day_limit) ?? DEFAULT_AI_ASSISTANT_RATE_LIMITS.orgDay,
  };
}

export function evaluateAiAssistantRateLimit(
  counts: AiAssistantRateLimitCounts,
  limits: AiAssistantRateLimits = DEFAULT_AI_ASSISTANT_RATE_LIMITS,
  retryAfterSeconds = 3600,
): AiAssistantRateLimitDecision {
  if (counts.userHour >= limits.userHour) {
    return {
      allowed: false,
      reason: 'user_hour',
      retryAfterSeconds,
      remainingUserHour: 0,
      remainingUserDay: Math.max(limits.userDay - counts.userDay, 0),
      remainingOrgDay:
        counts.orgDay == null ? null : Math.max(limits.orgDay - counts.orgDay, 0),
    };
  }
  if (counts.userDay >= limits.userDay) {
    return {
      allowed: false,
      reason: 'user_day',
      retryAfterSeconds,
      remainingUserHour: Math.max(limits.userHour - counts.userHour, 0),
      remainingUserDay: 0,
      remainingOrgDay:
        counts.orgDay == null ? null : Math.max(limits.orgDay - counts.orgDay, 0),
    };
  }
  if (counts.orgDay != null && counts.orgDay >= limits.orgDay) {
    return {
      allowed: false,
      reason: 'org_day',
      retryAfterSeconds,
      remainingUserHour: Math.max(limits.userHour - counts.userHour, 0),
      remainingUserDay: Math.max(limits.userDay - counts.userDay, 0),
      remainingOrgDay: 0,
    };
  }
  return {
    allowed: true,
    reason: 'allowed',
    retryAfterSeconds: null,
    remainingUserHour: Math.max(limits.userHour - counts.userHour - 1, 0),
    remainingUserDay: Math.max(limits.userDay - counts.userDay - 1, 0),
    remainingOrgDay:
      counts.orgDay == null ? null : Math.max(limits.orgDay - counts.orgDay - 1, 0),
  };
}

export function resolveCalendarDateRange(message: string, now = new Date()): CalendarDateRange {
  const normalized = message.toLowerCase();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let start = today;
  let days = 7;
  let recentFirst = false;

  const nextDaysMatch = normalized.match(/\bnext\s+(\d{1,3})\s+days?\b/);
  const explicitRangeMatch = normalized.match(
    /\b(?:from|between)\s+(\d{4}-\d{2}-\d{2})\s+(?:to|and|-)\s+(\d{4}-\d{2}-\d{2})\b/,
  );
  const explicitDateMatch = normalized.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const weekdayMatch = normalized.match(
    /\b(?:this\s+|next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  );
  const namedDayOnly = parseMonthNameDay(message.trim(), now);
  if (
    namedDayOnly?.kind === 'ok' &&
    /\b(show\s+calendar|what\s+happened|happened\s+on|calendar|kalender)\b/i.test(normalized)
  ) {
    start = dateFromDateOnly(namedDayOnly.date)!;
    days = 1;
  } else if (explicitRangeMatch?.[1] && explicitRangeMatch[2]) {
    const rangeStart = dateFromDateOnly(explicitRangeMatch[1]);
    const rangeEnd = dateFromDateOnly(explicitRangeMatch[2]);
    if (rangeStart && rangeEnd && rangeEnd >= rangeStart) {
      start = rangeStart;
      days = daysBetweenInclusive(explicitRangeMatch[1], explicitRangeMatch[2]);
    }
  } else if (explicitDateMatch?.[1]) {
    const explicitDate = dateFromDateOnly(explicitDateMatch[1]);
    if (explicitDate) {
      start = explicitDate;
      days = 1;
    }
  } else if (weekdayMatch?.[1]) {
    start = nextWeekdayDate(today, WEEKDAY_TO_UTC_DAY[weekdayMatch[1]]);
    days = 1;
  } else if (
    /\bwhen\s+was\s+(?:my\s+)?(?:the\s+)?last\s+(?:job|booking|casting|option)\b/i.test(
      normalized,
    ) ||
    /\bletzte[rn]?\s+(?:job|buchung|casting|option)\b/iu.test(normalized) ||
    /\bletzte\s+woche\b/iu.test(normalized) ||
    /\b(last|latest)\s+(?:event|entry|calendar\s+event|calendar\s+item)\b/i.test(normalized) ||
    /\bwhat\s+happened\s+last\b/i.test(normalized) ||
    /\bwhat\s+did\s+i\s+have\s+last\b/i.test(normalized) ||
    /\bwhat\s+was\s+(?:the\s+)?last\s+(?:event|entry)\b/i.test(normalized) ||
    isGlobalLastCalendarBrowseSummaryQuestion(normalized)
  ) {
    start = addDays(today, -(MAX_CALENDAR_RANGE_DAYS - 1));
    days = MAX_CALENDAR_RANGE_DAYS;
    recentFirst = true;
  } else if (normalized.includes('tomorrow') || /\bmorgen\b/iu.test(normalized)) {
    start = addDays(today, 1);
    days = 1;
  } else if (normalized.includes('today') || /\bheute\b/iu.test(normalized)) {
    days = 1;
  } else if (normalized.includes('next week') || /\bn[äa]chste\s+woche\b/iu.test(normalized)) {
    start = addDays(today, 1);
    days = 7;
  } else if (normalized.includes('this week') || /\bdiese\s+woche\b/iu.test(normalized)) {
    days = 7;
  } else if (nextDaysMatch) {
    days = Number(nextDaysMatch[1]);
  } else if (normalized.includes('month') || /\bmonat\b/iu.test(normalized)) {
    days = MAX_CALENDAR_RANGE_DAYS;
  }

  const cappedDays = Math.min(Math.max(days, 1), MAX_CALENDAR_RANGE_DAYS);
  return {
    startDate: dateOnly(start),
    endDate: dateOnly(addDays(start, cappedDays - 1)),
    wasCapped: days > cappedDays,
    ...(recentFirst ? { recentFirst: true as const } : {}),
  };
}

export function resolveCalendarDetailDateRange(now = new Date()): CalendarDateRange {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return {
    startDate: dateOnly(addDays(today, -(MAX_CALENDAR_DETAIL_LOOKBACK_DAYS - 1))),
    endDate: dateOnly(today),
    wasCapped: false,
  };
}

export function classifyAssistantIntent(
  message: string,
  role: ViewerRole,
  now = new Date(),
  assistantContext: AiAssistantContext | null = null,
): IntentClassification {
  const normalized = message.trim();
  if (!normalized) return { intent: 'help_static' };

  for (const [intent, pattern] of FORBIDDEN_PATTERNS) {
    if (
      (intent === 'billing' || intent === 'team_management') &&
      shouldExemptBillingOrTeamForbidden(normalized)
    ) {
      continue;
    }
    if (pattern.test(normalized)) return { intent };
  }

  if (role === 'agency' || role === 'client') {
    if (isGlobalLastCalendarBrowseSummaryQuestion(normalized)) {
      return { intent: 'calendar_summary', dateRange: resolveCalendarDateRange(normalized, now) };
    }
    if (isGlobalNextCalendarBrowseSummaryQuestion(normalized)) {
      return { intent: 'calendar_summary', dateRange: resolveCalendarDateRange(normalized, now) };
    }
  }

  const modelIntentFolded = normalizeTextForModelIntentMatching(normalized);
  const calendarQuestion = CALENDAR_PATTERNS.some((pattern) => pattern.test(normalized));
  const calendarDetailsQuestion =
    CALENDAR_DETAIL_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    CALENDAR_DETAIL_PRICE_PATTERN.test(normalized);
  const modelProfileQuestion = MODEL_PROFILE_PATTERNS_FOLDED.some((pattern) =>
    pattern.test(modelIntentFolded),
  );
  const modelInfoClarificationMatch = normalized.match(MODEL_INFO_CLARIFICATION_PATTERN);
  if (
    WRITE_ACTION_PATTERN.test(normalized) &&
    !POLITE_CAPABILITY_QUESTION.test(normalized) &&
    !/^\s*how\s+do\s+i\b/i.test(normalized)
  ) {
    return { intent: 'write_action' };
  }

  if (/\b(status|waiting\s+for)\b/i.test(normalized)) {
    return { intent: 'unknown_live_data' };
  }

  if (calendarDetailsQuestion && (role === 'agency' || role === 'client')) {
    return {
      intent: 'calendar_item_details',
      reference: resolveCalendarDetailReference(normalized),
      requestedField: resolveCalendarDetailRequestedField(normalized),
      kindHint: resolveCalendarDetailKindHint(normalized),
    };
  }

  const modelCalendarAvailability = classifyModelCalendarAvailabilityIntent(
    normalized,
    role,
    modelIntentFolded,
    assistantContext,
    now,
  );

  if (calendarQuestion && (role === 'agency' || role === 'client')) {
    if (isProductCalendarEducationQuestion(normalized)) {
      return { intent: 'help_static', helpSubtype: 'feature_explanation' };
    }
    if (looksLikeOrgCalendarSummaryPhrase(message)) {
      return { intent: 'calendar_summary', dateRange: resolveCalendarDateRange(normalized, now) };
    }
    if (modelCalendarAvailability && !hasBareAgencyCalendarSummaryShape(message)) {
      return modelCalendarAvailability;
    }
    return { intent: 'calendar_summary', dateRange: resolveCalendarDateRange(normalized, now) };
  }

  if (
    looksLikeOrgCalendarSummaryPhrase(normalized) &&
    (role === 'agency' || role === 'client')
  ) {
    return { intent: 'calendar_summary', dateRange: resolveCalendarDateRange(normalized, now) };
  }

  if (modelCalendarAvailability) {
    return modelCalendarAvailability;
  }

  if (modelProfileQuestion) {
    const contextModel =
      assistantContext &&
      isAssistantContextValid(assistantContext, now) &&
      typeof assistantContext.last_model_name === 'string'
        ? assistantContext.last_model_name.trim()
        : '';

    if (isPronounModelFactsQuestion(normalized)) {
      if (contextModel.length >= 2) {
        return { intent: 'model_visible_profile_facts', searchText: contextModel };
      }
      return {
        intent: 'model_visible_profile_facts',
        searchText: '',
        needsClarification: true,
        clarificationReason: 'which_model',
      };
    }

    const searchText = extractModelProfileSearchText(normalized);
    if (
      searchText.length >= 2 &&
      !isDenylistOnlyModelSearchName(searchText) &&
      hasPlausibleModelNameToken(searchText)
    ) {
      return { intent: 'model_visible_profile_facts', searchText };
    }
    if (contextModel.length >= 2) {
      return { intent: 'model_visible_profile_facts', searchText: contextModel };
    }
    return { intent: 'unknown_live_data' };
  }

  if (modelInfoClarificationMatch?.[1] && role === 'agency') {
    const searchText = normalizeSearchTextArtifacts(
      stripModelSearchNoise(modelInfoClarificationMatch[1]),
    );
    if (
      searchText.length >= 2 &&
      !isDenylistOnlyModelSearchName(searchText) &&
      hasPlausibleModelNameToken(searchText)
    ) {
      return {
        intent: 'model_visible_profile_facts',
        searchText,
        needsClarification: true,
        clarificationReason: 'what_info',
      };
    }
  }

  if (isProductCalendarEducationQuestion(normalized)) {
    return { intent: 'help_static', helpSubtype: 'feature_explanation' };
  }

  if (calendarQuestion || LIVE_DATA_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { intent: 'unknown_live_data' };
  }

  return { intent: 'help_static' };
}

function cleanNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function asCalendarKind(value: unknown): CalendarSummaryItem['kind'] | null {
  if (
    value === 'option' ||
    value === 'casting' ||
    value === 'job' ||
    value === 'private_event' ||
    value === 'booking'
  ) {
    return value;
  }
  return null;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted]')
    .replace(/https?:\/\/\S+/gi, '[redacted]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[redacted]')
    .replace(/\+\d[\d\s().-]{6,}\d/g, '[redacted]')
    .replace(/\(\d{2,5}\)\s*\d[\d\s.-]{4,}\d/g, '[redacted]')
    .replace(
      /\b(?:price|pricing|rate|fee|budget|revenue|invoice|billing)\s*[:=]?\s*(?:€|\$|£)?\s*\d[\d.,]*(?:\s?(?:eur|usd|gbp|dkk))?\b/gi,
      '[redacted]',
    )
    .replace(/(?:€|\$|£)\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:eur|usd|gbp|dkk)\b/gi, '[redacted]');
}

function cleanString(value: unknown, max = 160): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = redactSensitiveText(value).replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, max);
}

function cleanStringArray(value: unknown, maxItems = 8, maxItemChars = 40): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanString(item, maxItemChars))
    .filter((item): item is string => item != null)
    .slice(0, maxItems);
}

export function buildCalendarFacts(input: {
  role: Extract<ViewerRole, 'agency' | 'client'>;
  startDate: string;
  endDate: string;
  rangeWasCapped: boolean;
  rows: unknown[];
}): CalendarFacts {
  const safeRows = input.rows
    .map((row): CalendarSummaryItem | null => {
      if (!row || typeof row !== 'object') return null;
      const r = row as Record<string, unknown>;
      const kind = asCalendarKind(r.kind);
      const date = cleanString(r.date, 10);
      const title = cleanString(r.title, 120);
      const statusLabel = cleanString(r.status_label, 80);
      if (!kind || !date || !title || !statusLabel) return null;
      return {
        date,
        start_time: cleanString(r.start_time, 16),
        end_time: cleanString(r.end_time, 16),
        kind,
        title,
        model_name: cleanString(r.model_name, 120),
        counterparty_name: cleanString(r.counterparty_name, 120),
        status_label: statusLabel,
        note: cleanString(r.note, 200),
      };
    })
    .filter((row): row is CalendarSummaryItem => row != null);

  const items = safeRows.slice(0, MAX_CALENDAR_RESULTS);
  return {
    intent: 'calendar_summary',
    role: input.role,
    startDate: input.startDate,
    endDate: input.endDate,
    showingFirst: items.length,
    hasMore: safeRows.length > items.length,
    rangeWasCapped:
      input.rangeWasCapped ||
      daysBetweenInclusive(input.startDate, input.endDate) > MAX_CALENDAR_RANGE_DAYS,
    items,
  };
}

export function buildCalendarItemReference(item: CalendarSummaryItem): CalendarItemReference {
  return {
    date: item.date,
    start_time: item.start_time,
    end_time: item.end_time,
    kind: item.kind,
    title: item.title,
    model_name: item.model_name,
    counterparty_name: item.counterparty_name,
    status_label: item.status_label,
    note: item.note,
  };
}

export function findSingleCalendarReferenceFromFacts(
  facts: CalendarFacts | null,
  kindHint?: CalendarSummaryItem['kind'],
): CalendarItemReference | null | 'ambiguous' {
  if (!facts || facts.items.length === 0) return null;
  const items = kindHint ? facts.items.filter((item) => item.kind === kindHint) : facts.items;
  if (items.length === 1) return buildCalendarItemReference(items[0]);
  if (items.length > 1) return 'ambiguous';
  return null;
}

export function buildCalendarItemDetailsFacts(input: {
  role: Extract<ViewerRole, 'agency' | 'client'>;
  requestedField: CalendarDetailRequestedField;
  rows: unknown[];
}): CalendarItemDetailsFacts {
  const base = buildCalendarFacts({
    role: input.role,
    startDate: '1970-01-01',
    endDate: '1970-01-01',
    rangeWasCapped: false,
    rows: input.rows,
  }).items;

  if (base.length === 0) {
    return {
      intent: 'calendar_item_details',
      role: input.role,
      matchStatus: 'none',
      requestedField: input.requestedField,
    };
  }

  if (base.length > 1) {
    return {
      intent: 'calendar_item_details',
      role: input.role,
      matchStatus: 'ambiguous',
      requestedField: input.requestedField,
      candidates: base.map(buildCalendarItemReference),
    };
  }

  return {
    intent: 'calendar_item_details',
    role: input.role,
    matchStatus: 'found',
    requestedField: input.requestedField,
    item: base[0],
  };
}

function humanCalendarKind(kind: CalendarSummaryItem['kind']): string {
  switch (kind) {
    case 'option':
      return 'Option';
    case 'casting':
      return 'Casting';
    case 'job':
      return 'Job';
    case 'private_event':
      return 'Private event';
    case 'booking':
      return 'Booking';
  }
}

function formatCalendarDateTime(item: CalendarSummaryItem): string {
  const times = [item.start_time, item.end_time].filter(Boolean).join('–');
  return times ? `${item.date}, ${times}` : item.date;
}

export function resolveCalendarItemDetailsAnswer(facts: CalendarItemDetailsFacts): string {
  if (facts.requestedField === 'pricing') return CALENDAR_DETAIL_PRICING_REFUSAL;

  if (facts.matchStatus === 'none') {
    return 'I can’t find a visible calendar item matching that reference.';
  }

  if (facts.matchStatus === 'ambiguous') {
    const candidates = (facts.candidates ?? [])
      .slice(0, 5)
      .map((candidate) => {
        const parts = [
          humanCalendarKind(candidate.kind),
          candidate.title,
          candidate.date,
          candidate.model_name,
          candidate.counterparty_name,
        ].filter(Boolean);
        return parts.join(' · ');
      })
      .join('; ');
    return candidates ? `${CALENDAR_DETAIL_AMBIGUOUS_ANSWER} ${candidates}` : CALENDAR_DETAIL_AMBIGUOUS_ANSWER;
  }

  const item = facts.item;
  if (!item) return 'I can’t find a visible calendar item matching that reference.';

  switch (facts.requestedField) {
    case 'counterparty':
      return item.counterparty_name
        ? `The visible counterparty is ${item.counterparty_name}.`
        : 'I can’t see a visible counterparty for that item.';
    case 'model':
      return item.model_name
        ? `The visible model is ${item.model_name}.`
        : 'I can’t see a visible model for that item.';
    case 'date':
      return `It is on ${formatCalendarDateTime(item)}.`;
    case 'description':
      return item.note
        ? `The visible description is: ${item.note}`
        : 'I can’t see a visible note or description for that item.';
    case 'summary': {
      const lines = [
        `${humanCalendarKind(item.kind)}: ${item.title}`,
        `When: ${formatCalendarDateTime(item)}`,
        item.model_name ? `Model: ${item.model_name}` : null,
        item.counterparty_name ? `With: ${item.counterparty_name}` : null,
        item.status_label ? `Status: ${item.status_label}` : null,
        item.note ? `Description: ${item.note}` : null,
      ].filter(Boolean);
      return lines.join('\n');
    }
  }
  return CALENDAR_DETAIL_PRICING_REFUSAL;
}

export function buildAssistantContext(input: {
  lastCalendarItem?: CalendarSummaryItem | CalendarItemReference | null;
  lastModelName?: string | null;
  lastAvailabilityCheckDate?: string | null;
  lastAvailabilityDateSource?: 'single_day_resolve' | null;
  lastIntent?: AiAssistantContext['last_intent'];
  pendingCalendarKindPrompt?: boolean;
  createdAt?: Date;
  expiresAt?: Date;
}): AiAssistantContext {
  const context: AiAssistantContext = {};
  if (input.lastCalendarItem) {
    const item = input.lastCalendarItem;
    const kind = asCalendarKind(item.kind);
    const date = cleanString(item.date, 10);
    const title = cleanString(item.title, 120);
    if (kind && date && title) {
      context.last_calendar_item = {
        date,
        start_time: cleanString(item.start_time, 16),
        end_time: cleanString(item.end_time, 16),
        kind,
        title,
        model_name: cleanString(item.model_name, 120),
        counterparty_name: cleanString(item.counterparty_name, 120),
        status_label: cleanString(item.status_label, 80),
        note: cleanString(item.note, 200),
      };
      context.last_calendar_item_source = 'single_resolved_item';
    }
  }
  const modelName = cleanString(input.lastModelName, 120);
  if (modelName) {
    context.last_model_name = modelName;
    context.last_model_source = 'single_model_match';
  }
  const availRaw = cleanString(input.lastAvailabilityCheckDate, 10);
  if (availRaw && /^\d{4}-\d{2}-\d{2}$/.test(availRaw)) {
    context.last_availability_check_date = availRaw;
    context.last_availability_date_source = input.lastAvailabilityDateSource ?? 'single_day_resolve';
  }
  if (
    input.lastIntent === 'help_static' ||
    input.lastIntent === 'calendar_summary' ||
    input.lastIntent === 'calendar_item_details' ||
    input.lastIntent === 'model_visible_profile_facts' ||
    input.lastIntent === 'model_calendar_availability_check'
  ) {
    context.last_intent = input.lastIntent;
  }
  if (input.pendingCalendarKindPrompt === true) {
    context.pending_calendar_kind_prompt = true;
  }
  if (
    context.last_calendar_item ||
    context.last_model_name ||
    context.last_availability_check_date ||
    context.pending_calendar_kind_prompt === true
  ) {
    const createdAt = input.createdAt ?? new Date();
    const expiresAt =
      input.expiresAt ?? new Date(createdAt.getTime() + AI_ASSISTANT_CONTEXT_TTL_MS);
    context.context_created_at = createdAt.toISOString();
    context.context_expires_at = expiresAt.toISOString();
  }
  return context;
}

export function isAssistantContextValid(context: AiAssistantContext | null, now = new Date()): boolean {
  if (!context) return false;
  const hasCalendarItem =
    Boolean(context.last_calendar_item) &&
    context.last_calendar_item_source === 'single_resolved_item';
  const hasModelName =
    Boolean(context.last_model_name) && context.last_model_source === 'single_model_match';
  const hasAvailabilityFollowup =
    context.last_intent === 'model_calendar_availability_check' &&
    context.last_availability_date_source === 'single_day_resolve' &&
    typeof context.last_availability_check_date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(context.last_availability_check_date);
  const hasPendingKind =
    context.pending_calendar_kind_prompt === true &&
    (context.last_intent === 'calendar_item_details' || context.last_intent === 'calendar_summary');
  if (!hasCalendarItem && !hasModelName && !hasAvailabilityFollowup && !hasPendingKind) return false;

  if (typeof context.context_created_at !== 'string' || typeof context.context_expires_at !== 'string') {
    return false;
  }
  const createdAt = Date.parse(context.context_created_at);
  const expiresAt = Date.parse(context.context_expires_at);
  const nowMs = now.getTime();
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) return false;
  if (createdAt > nowMs + 30_000) return false;
  if (expiresAt <= nowMs) return false;
  if (expiresAt - createdAt > AI_ASSISTANT_CONTEXT_TTL_MS + 30_000) return false;
  return true;
}

export function expandKindOnlyCalendarFollowup(
  message: string,
  assistantContext: AiAssistantContext | null,
  now = new Date(),
): string | null {
  const m = message.trim();
  if (!CALENDAR_KIND_ONLY_REPLY.test(m)) return null;
  if (!isAssistantContextValid(assistantContext, now)) return null;
  if (assistantContext!.pending_calendar_kind_prompt !== true) return null;
  const match = m.match(CALENDAR_KIND_ONLY_REPLY);
  const raw = (match?.[1] ?? '').toLowerCase();
  if (raw === 'job') return 'When was the last job?';
  if (raw === 'casting') return 'When was the last casting?';
  if (raw === 'option') return 'When was the last option?';
  if (raw === 'booking') return 'When was the last booking?';
  return null;
}

export function resolveCalendarItemDetailsAnswerFromContext(
  context: AiAssistantContext | null,
  requestedField: CalendarDetailRequestedField,
  now = new Date(),
): string | null {
  if (requestedField === 'pricing') return CALENDAR_DETAIL_PRICING_REFUSAL;
  if (!isAssistantContextValid(context, now)) return null;
  const item = context?.last_calendar_item;
  if (!item) return null;
  return resolveCalendarItemDetailsAnswer({
    intent: 'calendar_item_details',
    role: 'agency',
    matchStatus: 'found',
    requestedField,
    item: {
      date: item.date,
      start_time: item.start_time ?? null,
      end_time: item.end_time ?? null,
      kind: item.kind,
      title: item.title,
      model_name: item.model_name,
      counterparty_name: item.counterparty_name,
      status_label: item.status_label ?? 'Visible calendar item',
      note: item.note ?? null,
    },
  });
}

export function buildModelVisibleProfileFacts(input: {
  rows: ModelVisibleProfileRow[];
}): ModelVisibleProfileFacts {
  const safeRows = input.rows
    .map((row): ModelVisibleProfileFacts['model'] | null => {
      const displayName = cleanString(row.display_name, 120);
      if (!displayName) return null;
      return {
        display_name: displayName,
        city: cleanString(row.city, 80),
        country: cleanString(row.country, 80),
        measurements: {
          height: cleanNumber(row.height),
          chest: cleanNumber(row.chest),
          waist: cleanNumber(row.waist),
          hips: cleanNumber(row.hips),
          shoes: cleanNumber(row.shoes),
        },
        hair: cleanString(row.hair, 80),
        eyes: cleanString(row.eyes, 80),
        categories: cleanStringArray(row.categories),
        account_linked: row.account_linked === true,
      };
    })
    .filter((row): row is NonNullable<ModelVisibleProfileFacts['model']> => row != null)
    .slice(0, MAX_MODEL_FACT_CANDIDATES);

  if (safeRows.length === 0) {
    return { intent: 'model_visible_profile_facts', role: 'agency', matchStatus: 'none' };
  }

  if (safeRows.length > 1) {
    return {
      intent: 'model_visible_profile_facts',
      role: 'agency',
      matchStatus: 'ambiguous',
      candidates: safeRows.map((row) => ({
        display_name: row.display_name,
        city: row.city,
        country: row.country,
      })),
    };
  }

  return {
    intent: 'model_visible_profile_facts',
    role: 'agency',
    matchStatus: 'found',
    model: safeRows[0],
  };
}

export function resolveModelFactsExecutionResult(input: {
  role: ViewerRole;
  facts: ModelVisibleProfileFacts;
}): ModelFactsExecutionResult {
  if (input.role === 'client') {
    return { type: 'answer', answer: CLIENT_MODEL_FACTS_REFUSAL };
  }
  if (input.role !== 'agency') {
    return { type: 'answer', answer: 'I can’t access agency-only model profile facts from this workspace.' };
  }

  if (input.facts.matchStatus === 'none') {
    return {
      type: 'answer',
      answer: 'I can’t find a visible model matching that name in your agency workspace.',
    };
  }

  if (input.facts.matchStatus === 'ambiguous') {
    const names = (input.facts.candidates ?? [])
      .map((candidate) => {
        const location = [candidate.city, candidate.country].filter(Boolean).join(', ');
        return location ? `${candidate.display_name} (${location})` : candidate.display_name;
      })
      .join('; ');
    return {
      type: 'answer',
      answer: names
        ? `I found multiple visible models matching that. Which one do you mean? ${names}`
        : 'I found multiple visible models matching that. Which one do you mean?',
    };
  }

  return {
    type: 'mistral',
    facts: input.facts,
  };
}

export type ModelCalendarAvailabilityExecutionResult =
  | { type: 'answer'; answer: string }
  | { type: 'mistral'; facts: ModelCalendarAvailabilityFacts };

function humanCalendarKindLabel(kind: string): string {
  switch (kind) {
    case 'option':
      return 'Option';
    case 'casting':
      return 'Casting';
    case 'job':
      return 'Job';
    case 'private_event':
      return 'Private event';
    case 'booking':
      return 'Booking';
    default:
      return 'Calendar item';
  }
}

export function buildModelCalendarAvailabilityFactsFromRpc(raw: unknown): ModelCalendarAvailabilityFacts | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.match_status !== 'found') return null;
  const modelName = cleanString(r.model_display_name, 120);
  const checkDate = cleanString(r.check_date, 10);
  if (!modelName || !checkDate) return null;
  const eventsRaw = r.events;
  const events: ModelCalendarAvailabilityEvent[] = [];
  if (Array.isArray(eventsRaw)) {
    for (const item of eventsRaw.slice(0, 20)) {
      if (!item || typeof item !== 'object') continue;
      const e = item as Record<string, unknown>;
      const kindRaw = typeof e.kind === 'string' ? e.kind : '';
      const title = cleanString(e.title, 120);
      if (!title) continue;
      events.push({
        kind_label: humanCalendarKindLabel(kindRaw),
        start_time: cleanString(e.start_time, 16),
        end_time: cleanString(e.end_time, 16),
        title,
        counterparty_name: cleanString(e.counterparty_name, 120),
        note: cleanString(e.note, 200),
      });
    }
  }
  return {
    intent: 'model_calendar_availability_check',
    role: 'agency',
    disclaimer: AVAILABILITY_DISCLAIMER,
    model_display_name: modelName,
    check_date: checkDate,
    has_visible_conflicts: r.has_visible_conflicts === true || events.length > 0,
    events,
  };
}

export function formatModelCalendarAvailabilityDeterministic(facts: ModelCalendarAvailabilityFacts): string {
  const disclaimer = facts.disclaimer;
  if (!facts.has_visible_conflicts || facts.events.length === 0) {
    return `I don’t see any visible calendar conflicts for ${facts.model_display_name} on ${facts.check_date}. ${disclaimer}`;
  }
  const lines = facts.events.map((e) => {
    const t = [e.start_time, e.end_time].filter(Boolean).join('–');
    const who = e.counterparty_name ? ` · ${e.counterparty_name}` : '';
    return `- ${e.kind_label}${t ? ` (${t})` : ''}: ${e.title}${who}`;
  });
  return `Visible calendar conflicts for ${facts.model_display_name} on ${facts.check_date}:\n${lines.join(
    '\n',
  )}\n\n${disclaimer}`;
}

export function interpretModelCalendarConflictsRpc(raw: unknown): {
  matchStatus: 'none' | 'ambiguous' | 'found' | 'invalid';
  candidates: string[];
  facts: ModelCalendarAvailabilityFacts | null;
} {
  if (!raw || typeof raw !== 'object') {
    return { matchStatus: 'invalid', candidates: [], facts: null };
  }
  const r = raw as Record<string, unknown>;
  const status = r.match_status;
  if (status === 'none') {
    return { matchStatus: 'none', candidates: [], facts: null };
  }
  if (status === 'ambiguous') {
    const c = r.candidates;
    const names: string[] = [];
    if (Array.isArray(c)) {
      for (const item of c) {
        const s = typeof item === 'string' ? cleanString(item, 120) : null;
        if (s) names.push(s);
      }
    }
    return { matchStatus: 'ambiguous', candidates: names, facts: null };
  }
  if (status === 'found') {
    const facts = buildModelCalendarAvailabilityFactsFromRpc(raw);
    return { matchStatus: facts ? 'found' : 'invalid', candidates: [], facts };
  }
  return { matchStatus: 'invalid', candidates: [], facts: null };
}

export function resolveModelCalendarAvailabilityExecutionResult(input: {
  role: ViewerRole;
  interpret: ReturnType<typeof interpretModelCalendarConflictsRpc>;
}): ModelCalendarAvailabilityExecutionResult {
  if (input.role === 'client') {
    return { type: 'answer', answer: CLIENT_MODEL_AVAILABILITY_REFUSAL };
  }
  if (input.role === 'model') {
    return { type: 'answer', answer: MODEL_WORKSPACE_AVAILABILITY_REFUSAL };
  }
  if (input.role !== 'agency') {
    return {
      type: 'answer',
      answer: 'I can’t check agency model availability from this workspace.',
    };
  }

  if (input.interpret.matchStatus === 'invalid') {
    return { type: 'answer', answer: 'I can’t read visible calendar conflicts right now.' };
  }

  if (input.interpret.matchStatus === 'none') {
    return {
      type: 'answer',
      answer:
        'I can’t find a visible model matching that name in your agency workspace.',
    };
  }

  if (input.interpret.matchStatus === 'ambiguous') {
    const list = input.interpret.candidates.slice(0, 5).join(', ');
    return {
      type: 'answer',
      answer: list
        ? `I found multiple visible models matching that name: ${list}. Which one do you mean?`
        : 'I found multiple visible models matching that name. Which one do you mean?',
    };
  }

  if (!input.interpret.facts) {
    return { type: 'answer', answer: 'I can’t read visible calendar conflicts right now.' };
  }

  return { type: 'mistral', facts: input.interpret.facts };
}

export function forbiddenIntentAnswer(
  intent: Exclude<
    AssistantIntent,
    | 'help_static'
    | 'calendar_summary'
    | 'calendar_item_details'
    | 'model_visible_profile_facts'
    | 'model_calendar_availability_check'
  >,
  role?: ViewerRole,
): string {
  switch (intent) {
    case 'billing':
      return 'I can’t access billing, invoices, payments, or subscription details here. Please use the Billing area in IndexCasting.';
    case 'team_management':
      return 'I can’t access or manage team members or invitations here. Please use the Team area if it is available for your role.';
    case 'admin_security':
    case 'database_schema':
      return 'I can’t help with internal security or implementation details.';
    case 'raw_messages':
      return 'I can’t show raw messages or chat history here. Please use Messages in IndexCasting.';
    case 'cross_org':
      return 'I can only answer questions about data visible in your own organization.';
    case 'write_action':
      return 'I can’t perform actions or change data. I can explain where to do this in IndexCasting.';
    case 'model_hidden_data':
      if (role === 'client') return CLIENT_MODEL_FACTS_REFUSAL;
      return 'I can’t reveal hidden or private model data. I can only help with basic visible model profile facts.';
    case 'gdpr_export_delete':
      return 'I can’t process account deletion or personal data exports here. Please use the privacy/account settings flow.';
    case 'unknown_live_data':
      if (role === 'agency') {
        return 'That live-data question is not available in the assistant. I can answer limited calendar questions and basic visible model profile facts for your agency workspace.';
      }
      if (role === 'client') {
        return 'That live-data question is not available in the Client workspace. I can answer limited calendar questions.';
      }
      return 'That live-data question is not available in this workspace.';
  }
}
