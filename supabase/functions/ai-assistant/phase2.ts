export type ViewerRole = 'agency' | 'client' | 'model';

export type AssistantIntent =
  | 'help_static'
  | 'calendar_summary'
  | 'calendar_item_details'
  | 'model_visible_profile_facts'
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
};

export type IntentClassification =
  | { intent: 'help_static' }
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
      intent: Exclude<
        AssistantIntent,
        'help_static' | 'calendar_summary' | 'calendar_item_details' | 'model_visible_profile_facts'
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
  last_intent?: Extract<
    AssistantIntent,
    'help_static' | 'calendar_summary' | 'calendar_item_details' | 'model_visible_profile_facts'
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
export const AI_ASSISTANT_LIMIT_REACHED_ANSWER =
  'You’ve reached the AI assistant usage limit. Please try again later. Contact your organization admin if you need higher limits.';
export const AI_ASSISTANT_UNAVAILABLE_ANSWER =
  'AI Help is temporarily unavailable. Please try again later.';
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
      'help_static' | 'calendar_summary' | 'calendar_item_details' | 'model_visible_profile_facts'
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
  ['database_schema', /\b(service[_\s-]?role|sql|query the database|database|schema|table|tables|rpc|rls|migration|supabase internals?|internal ids?|org ids?|organization ids?|uuids?)\b/i],
  ['raw_messages', /\b(raw messages?|chat history|message dump|all messages?|what did .* (say|write|send)|show .* messages?)\b/i],
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

const CALENDAR_PATTERNS = [
  /\bcalendar\b/i,
  /\bwhat\s+(?:is|what's)\s+on\s+(?:my|our)?\s*calendar\b/i,
  /\bshow\s+(?:my|our)?\s*calendar\b/i,
  /\bwhat\s+(?:do\s+i|do\s+we)\s+have\b.*\b(today|tomorrow|this week|next week|next \d+ days?|soon|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b/i,
  /\bwhat\s+(?:bookings?|options?|castings?|jobs?|requests?)\s+do\s+(?:i|we)\s+have\b/i,
  /\bdo\s+(?:i|we)\s+have\s+any\s+(?:bookings?|options?|castings?|jobs?|requests?)\b/i,
  /\b(what|show|list|tell me|do i|do we|have|what's|what is|who)\b.*\b(today|tomorrow|this week|next week|next \d+ days?|month|soon|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b.*\b(options?|castings?|jobs?|bookings?|booked|requests?)\b/i,
  /\b(options?|castings?|jobs?|bookings?|booked|requests?)\b.*\b(today|tomorrow|this week|next week|next \d+ days?|month|soon|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b/i,
  /\bwhat (is|do we have|do i have).*\b(today|tomorrow|next week|this week|soon|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b/i,
  /\b(?:from|between)\s+\d{4}-\d{2}-\d{2}\s+(?:to|and|-)\s+\d{4}-\d{2}-\d{2}\b/i,
  /\bwhen\s+was\s+(?:my\s+)?(?:the\s+)?last\s+(?:job|booking|casting|option)\b/i,
];

const CALENDAR_DETAIL_PATTERNS = [
  /^\s*tell me more\s*$/i,
  /^\s*what\s+job\??\s*$/i,
  /\b(details?|more|tell me more)\b.*\b(that|this|last|job|booking|casting|option|calendar item|event)\b/i,
  /\b(that|this|last)\s+(job|booking|casting|option|calendar item|event)\b/i,
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
  /\bwhat\s+was\s+(?:the\s+)?(?:description|note)\b/i,
];

const CALENDAR_DETAIL_PRICE_PATTERN =
  /\b(price|pricing|cost|fee|rate|budget|amount|how much|paid|pay)\b/i;

const MODEL_PROFILE_PATTERNS = [
  /\b(measurements?|dimensions?)\b.*\b(?:of|for)\b.*\b(model\s+)?[a-z][\p{L}\p{N}'’.\-\s]{1,80}\b/iu,
  /\b(?:height|city|base|based|location|located|hair|eyes?|shoes?|shoe size|chest|bust|waist|hips)\b.*\b(?:of|for|does|is|has|have)\b.*\b[a-z][\p{L}\p{N}'’.\-\s]{1,80}\b/iu,
  /\b(?:what|show|tell me|give me)\b.*\b(?:profile facts?|basic facts?|model facts?)\b.*\b[a-z][\p{L}\p{N}'’.\-\s]{1,80}\b/iu,
  /\bdoes\b.*\b[a-z][\p{L}\p{N}'’.\-\s]{1,80}\b.*\bhave an account\b/iu,
  /\bmodel\s+dimensions?\b.*\b[a-z][\p{L}\p{N}'’.\-\s]{1,80}\b/iu,
  /\bdo(?:es)?\b.*\b(measurements?|dimensions?)\b.*\bmatch\b/iu,
  /\b(?:her|his|their)\s+(?:measurements?|dimensions?|height|city|location|shoes?|shoe size|chest|bust|waist|hips|hair|eyes?)\b/i,
  /\b(?:this|that)\s+model\b.*\b(?:measurements?|dimensions?|height|city|location|shoes?|shoe size|chest|bust|waist|hips|hair|eyes?|account)\b/i,
];

const MODEL_INFO_CLARIFICATION_PATTERN =
  /^\s*what\s+about\s+([a-z\p{L}\p{N}'’.\-\s]{2,80})\??\s*$/iu;

const WRITE_ACTION_PATTERN =
  /^(please\s+)?(create|add|book|confirm|cancel|delete|remove|update|send|invite)\b|\b(create|add|book|confirm|cancel|delete|remove|update|send|invite)\b.*\b(for me|now|today|tomorrow|next week)\b/i;

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

function stripModelSearchNoise(value: string): string {
  return value
    .replace(/\b(what|are|is|the|of|for|model|show|me|basic|profile|facts|does|have|an|account|height|measurements?|dimensions?|city|base|based|location|located|hair|eyes?|shoes?|shoe size|chest|bust|waist|hips|here|received|match|system|compare|against|with|in|on|my|our|visible)\b/giu, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\b/g, ' ')
    .replace(/[?:;,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MODEL_SEARCH_CHARS);
}

function resolveCalendarDetailRequestedField(message: string): CalendarDetailRequestedField {
  if (CALENDAR_DETAIL_PRICE_PATTERN.test(message)) return 'pricing';
  if (/\bwhich\s+model\b|\bmodel\b.*\b(in|for)\b/i.test(message)) return 'model';
  if (/\b(client|agency|counterparty|who\s+was\s+it\s+with|who\s+was\s+.*with)\b/i.test(message)) {
    return 'counterparty';
  }
  if (/\bwhen|date|time|start|end|how\s+long\b/i.test(message)) return 'date';
  if (/\b(description|note)\b/i.test(message)) return 'description';
  return 'summary';
}

function resolveCalendarDetailReference(message: string): 'followup' | 'last_job' {
  if (/\blast\s+job\b/i.test(message)) return 'last_job';
  return 'followup';
}

function resolveCalendarDetailKindHint(message: string): CalendarSummaryItem['kind'] | undefined {
  if (/\bcasting\b/i.test(message)) return 'casting';
  if (/\boption\b/i.test(message)) return 'option';
  if (/\bjob\b/i.test(message)) return 'job';
  if (/\bbooking\b/i.test(message)) return 'booking';
  if (/\bprivate\s+event\b/i.test(message)) return 'private_event';
  return undefined;
}

function isPronounModelFactsQuestion(message: string): boolean {
  return (
    /\b(?:her|his|their)\s+(?:measurements?|dimensions?|height|city|location|shoes?|shoe size|chest|bust|waist|hips|hair|eyes?)\b/i.test(
      message,
    ) ||
    /\b(?:this|that)\s+model\b.*\b(?:measurements?|dimensions?|height|city|location|shoes?|shoe size|chest|bust|waist|hips|hair|eyes?|account)\b/i.test(
      message,
    )
  );
}

export function extractModelProfileSearchText(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  const bracketMatch = normalized.match(/\[([^\]]{2,80})\]/);
  if (bracketMatch?.[1]) return bracketMatch[1].trim().slice(0, MAX_MODEL_SEARCH_CHARS);

  const possessiveMatch = normalized.match(/\b([A-Z][\p{L}\p{N}'’.\-]*(?:\s+[A-Z][\p{L}\p{N}'’.\-]*){0,3})['’]s\b/u);
  if (possessiveMatch?.[1]) return possessiveMatch[1].trim().slice(0, MAX_MODEL_SEARCH_CHARS);

  const namedAfterPreposition = normalized.match(/\b(?:of|for)\s+([A-Z][\p{L}\p{N}'’.\-]*(?:\s+[A-Z][\p{L}\p{N}'’.\-]*){0,3})\b/u);
  if (namedAfterPreposition?.[1]) return namedAfterPreposition[1].trim().slice(0, MAX_MODEL_SEARCH_CHARS);

  const namedAfterForLower = normalized.match(/\b(?:of|for)\s+([a-z][\p{L}\p{N}'’.\-]*(?:\s+[a-z][\p{L}\p{N}'’.\-]*){0,3})\b/iu);
  if (namedAfterForLower?.[1]) return stripModelSearchNoise(namedAfterForLower[1]);

  return stripModelSearchNoise(normalized);
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

  const nextDaysMatch = normalized.match(/\bnext\s+(\d{1,3})\s+days?\b/);
  const explicitRangeMatch = normalized.match(
    /\b(?:from|between)\s+(\d{4}-\d{2}-\d{2})\s+(?:to|and|-)\s+(\d{4}-\d{2}-\d{2})\b/,
  );
  const explicitDateMatch = normalized.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const weekdayMatch = normalized.match(
    /\b(?:this\s+|next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  );
  if (explicitRangeMatch?.[1] && explicitRangeMatch[2]) {
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
  } else if (/\bwhen\s+was\s+(?:my\s+)?(?:the\s+)?last\s+(?:job|booking|casting|option)\b/i.test(normalized)) {
    start = addDays(today, -(MAX_CALENDAR_RANGE_DAYS - 1));
    days = MAX_CALENDAR_RANGE_DAYS;
  } else if (normalized.includes('tomorrow')) {
    start = addDays(today, 1);
    days = 1;
  } else if (normalized.includes('today')) {
    days = 1;
  } else if (normalized.includes('next week')) {
    start = addDays(today, 1);
    days = 7;
  } else if (normalized.includes('this week')) {
    days = 7;
  } else if (nextDaysMatch) {
    days = Number(nextDaysMatch[1]);
  } else if (normalized.includes('month')) {
    days = MAX_CALENDAR_RANGE_DAYS;
  }

  const cappedDays = Math.min(Math.max(days, 1), MAX_CALENDAR_RANGE_DAYS);
  return {
    startDate: dateOnly(start),
    endDate: dateOnly(addDays(start, cappedDays - 1)),
    wasCapped: days > cappedDays,
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
): IntentClassification {
  const normalized = message.trim();
  if (!normalized) return { intent: 'help_static' };

  for (const [intent, pattern] of FORBIDDEN_PATTERNS) {
    if (pattern.test(normalized)) return { intent };
  }

  const calendarQuestion = CALENDAR_PATTERNS.some((pattern) => pattern.test(normalized));
  const calendarDetailsQuestion =
    CALENDAR_DETAIL_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    CALENDAR_DETAIL_PRICE_PATTERN.test(normalized);
  const modelProfileQuestion = MODEL_PROFILE_PATTERNS.some((pattern) => pattern.test(normalized));
  const modelInfoClarificationMatch = normalized.match(MODEL_INFO_CLARIFICATION_PATTERN);
  if (WRITE_ACTION_PATTERN.test(normalized) && !/^\s*how\s+do\s+i\b/i.test(normalized)) {
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

  if (calendarQuestion && (role === 'agency' || role === 'client')) {
    return { intent: 'calendar_summary', dateRange: resolveCalendarDateRange(normalized, now) };
  }

  if (modelProfileQuestion) {
    if (isPronounModelFactsQuestion(normalized)) {
      return {
        intent: 'model_visible_profile_facts',
        searchText: '',
        needsClarification: true,
        clarificationReason: 'which_model',
      };
    }
    const searchText = extractModelProfileSearchText(normalized);
    if (!searchText || searchText.length < 2) return { intent: 'unknown_live_data' };
    return { intent: 'model_visible_profile_facts', searchText };
  }

  if (modelInfoClarificationMatch?.[1] && role === 'agency') {
    const searchText = stripModelSearchNoise(modelInfoClarificationMatch[1]);
    if (searchText.length >= 2) {
      return {
        intent: 'model_visible_profile_facts',
        searchText,
        needsClarification: true,
        clarificationReason: 'what_info',
      };
    }
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
        : 'No visible counterparty is shown for that calendar item.';
    case 'model':
      return item.model_name
        ? `The visible model is ${item.model_name}.`
        : 'No visible model is shown for that calendar item.';
    case 'date':
      return `It is on ${formatCalendarDateTime(item)}.`;
    case 'description':
      return item.note
        ? `The visible description is: ${item.note}`
        : 'No visible description or note is shown for that calendar item.';
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
  lastIntent?: AiAssistantContext['last_intent'];
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
  if (
    input.lastIntent === 'help_static' ||
    input.lastIntent === 'calendar_summary' ||
    input.lastIntent === 'calendar_item_details' ||
    input.lastIntent === 'model_visible_profile_facts'
  ) {
    context.last_intent = input.lastIntent;
  }
  if (context.last_calendar_item || context.last_model_name) {
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
  if (!hasCalendarItem && !hasModelName) return false;

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

export function forbiddenIntentAnswer(
  intent: Exclude<
    AssistantIntent,
    'help_static' | 'calendar_summary' | 'calendar_item_details' | 'model_visible_profile_facts'
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
