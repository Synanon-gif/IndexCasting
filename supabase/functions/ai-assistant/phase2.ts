export type ViewerRole = 'agency' | 'client' | 'model';

export type AssistantIntent =
  | 'help_static'
  | 'calendar_summary'
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
  | { intent: 'model_visible_profile_facts'; searchText: string; needsClarification?: boolean }
  | { intent: Exclude<AssistantIntent, 'help_static' | 'calendar_summary' | 'model_visible_profile_facts'> };

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

export const CALENDAR_UNSUPPORTED_RANGE_ANSWER =
  'I can answer limited calendar questions for a specific date range. Try asking what is on your calendar today, tomorrow, or next week.';
export const MODEL_CLARIFICATION_ANSWER = 'Which model do you mean?';
export const CLIENT_MODEL_FACTS_REFUSAL =
  'I can’t access agency-only model profile facts from the Client workspace.';

export const MAX_CALENDAR_RANGE_DAYS = 31;
export const MAX_CALENDAR_RESULTS = 25;
export const MAX_MODEL_FACT_CANDIDATES = 5;
export const MAX_MODEL_SEARCH_CHARS = 80;

const FORBIDDEN_PATTERNS: Array<[Exclude<AssistantIntent, 'help_static' | 'calendar_summary' | 'model_visible_profile_facts'>, RegExp]> = [
  ['cross_org', /\b(another|other|different|all)\s+(agency|agencies|client|clients|org|organization|company|companies)\b/i],
  ['cross_org', /\b(cross[-\s]?org|outside (my|our) (org|organization)|from another)\b/i],
  ['cross_org', /\b(all|every|export)\s+models?\b/i],
  ['billing', /\b(billing|invoice|invoices|payment|payments|subscription|subscriptions|stripe|tax|vat|bank|payout|settlement)\b/i],
  ['gdpr_export_delete', /\b(gdpr|export (my|all|personal)|personal data export|delete (my )?account|account deletion|delete organization|dissolve organization)\b/i],
  ['team_management', /\b(invite|invitation|team member|team members|member list|members list|organization members|remove member|add member)\b/i],
  ['admin_security', /\b(admin|security|api key|secret|system prompt|developer instruction|policy|policies|permissions)\b/i],
  ['database_schema', /\b(service[_\s-]?role|sql|query the database|database|schema|table|tables|rpc|rls|migration|supabase internals?)\b/i],
  ['raw_messages', /\b(raw messages?|chat history|message dump|all messages?|what did .* (say|write|send)|show .* messages?)\b/i],
  ['model_hidden_data', /\b(hidden model|hidden models|private model|private models|model email|model emails|email address|phone|phone number|all models from|not visible model|invisible model|private notes?|hidden notes?|admin notes?|private pictures?|private photos?|hidden pictures?|hidden photos?|raw storage|file urls?|storage paths?|mediaslide|sync id|internal ids?)\b/i],
];

const LIVE_DATA_PATTERNS = [
  /\b(which|what|show|list|give me|tell me)\b.*\b(bookings?|options?|castings?|requests?|models?|organization|team|members?|projects?)\b/i,
  /\b(status)\b.*\b(my|our|this)\b.*\b(request|option|casting|booking|project)\b/i,
  /\b(available|availability)\b.*\b(today|tomorrow|this week|next week|now)\b/i,
  /\b(who)\b.*\b(organization|team|company|agency|client)\b/i,
];

const CALENDAR_PATTERNS = [
  /\bcalendar\b/i,
  /\bwhat\s+(?:is|what's)\s+on\s+(?:my|our)?\s*calendar\b/i,
  /\bshow\s+(?:my|our)?\s*calendar\b/i,
  /\bwhat\s+(?:do\s+i|do\s+we)\s+have\b.*\b(today|tomorrow|this week|next week|next \d+ days?)\b/i,
  /\bwhat\s+(?:bookings?|options?|castings?|jobs?|requests?)\s+do\s+(?:i|we)\s+have\b/i,
  /\bdo\s+(?:i|we)\s+have\s+any\s+(?:bookings?|options?|castings?|jobs?|requests?)\b/i,
  /\b(what|show|list|tell me|do i|do we|have|what's|what is)\b.*\b(today|tomorrow|this week|next week|next \d+ days?|month)\b.*\b(options?|castings?|jobs?|bookings?|requests?)\b/i,
  /\b(options?|castings?|jobs?|bookings?|requests?)\b.*\b(today|tomorrow|this week|next week|next \d+ days?|month)\b/i,
  /\bwhat (is|do we have|do i have).*\b(today|tomorrow|next week|this week)\b/i,
  /\bwhen\s+was\s+(?:my\s+)?(?:the\s+)?last\s+(?:job|booking|casting|option)\b/i,
];

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

const WRITE_ACTION_PATTERN =
  /^(please\s+)?(create|add|book|confirm|cancel|delete|remove|update|send|invite)\b|\b(create|add|book|confirm|cancel|delete|remove|update|send|invite)\b.*\b(for me|now|today|tomorrow|next week)\b/i;

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

function stripModelSearchNoise(value: string): string {
  return value
    .replace(/\b(what|are|is|the|of|for|model|show|me|basic|profile|facts|does|have|an|account|height|measurements?|dimensions?|city|base|based|location|located|hair|eyes?|shoes?|shoe size|chest|bust|waist|hips|here|received|match|system|compare|against|with|in|on|my|our|visible)\b/giu, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\b/g, ' ')
    .replace(/[?:;,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MODEL_SEARCH_CHARS);
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

export function resolveCalendarDateRange(message: string, now = new Date()): CalendarDateRange {
  const normalized = message.toLowerCase();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let start = today;
  let days = 7;

  const nextDaysMatch = normalized.match(/\bnext\s+(\d{1,3})\s+days?\b/);
  if (/\bwhen\s+was\s+(?:my\s+)?(?:the\s+)?last\s+(?:job|booking|casting|option)\b/i.test(normalized)) {
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
  const modelProfileQuestion = MODEL_PROFILE_PATTERNS.some((pattern) => pattern.test(normalized));
  if (WRITE_ACTION_PATTERN.test(normalized) && !/^\s*how\s+do\s+i\b/i.test(normalized)) {
    return { intent: 'write_action' };
  }

  if (calendarQuestion && (role === 'agency' || role === 'client')) {
    return { intent: 'calendar_summary', dateRange: resolveCalendarDateRange(normalized, now) };
  }

  if (modelProfileQuestion) {
    if (isPronounModelFactsQuestion(normalized)) {
      return { intent: 'model_visible_profile_facts', searchText: '', needsClarification: true };
    }
    const searchText = extractModelProfileSearchText(normalized);
    if (!searchText || searchText.length < 2) return { intent: 'unknown_live_data' };
    return { intent: 'model_visible_profile_facts', searchText };
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

function cleanString(value: unknown, max = 160): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
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

export function forbiddenIntentAnswer(intent: Exclude<AssistantIntent, 'help_static' | 'calendar_summary' | 'model_visible_profile_facts'>): string {
  switch (intent) {
    case 'billing':
      return 'I can’t access billing, invoices, payments, or subscription details here. Please use the Billing area in IndexCasting.';
    case 'team_management':
      return 'I can’t access or manage team members or invitations here. Please use the Team area if it is available for your role.';
    case 'admin_security':
    case 'database_schema':
      return 'I can’t help with internal security, database, schema, RLS, or implementation details.';
    case 'raw_messages':
      return 'I can’t show raw messages or chat history here. Please use Messages in IndexCasting.';
    case 'cross_org':
      return 'I can only answer questions about data visible in your own organization.';
    case 'write_action':
      return 'I can’t perform actions or change data. I can explain where to do this in IndexCasting.';
    case 'model_hidden_data':
      return 'I can’t reveal hidden or private model data. I can only help with basic visible model profile facts.';
    case 'gdpr_export_delete':
      return 'I can’t process account deletion or personal data exports here. Please use the privacy/account settings flow.';
    case 'unknown_live_data':
      return 'That live-data question is not available in the assistant yet. For now I can only answer limited calendar questions and Agency-only visible model profile facts.';
  }
}
