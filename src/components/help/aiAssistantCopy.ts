import { uiCopy } from '../../constants/uiCopy';

export type AiAssistantViewerRole = 'agency' | 'client' | 'model';
export type AiAssistantWorkflowTopic = 'option' | 'casting';

const AGENCY_NAV_LABELS = [
  'Dashboard',
  'My Models',
  'Clients',
  'Messages',
  'Calendar',
  'Recruiting',
  'Team',
  'Links',
  'Billing',
  'Settings',
] as const;

const CLIENT_NAV_LABELS = [
  'Dashboard',
  'Discover',
  'My Projects',
  'Messages',
  'Calendar',
  'Agencies',
  'Team',
  'Billing',
  'Profile',
] as const;

const LIVE_DATA_PATTERNS = [
  /\b(which|what|show|list|give me|tell me)\b.*\b(bookings?|options?|castings?|requests?|invoices?|messages?|models?|organization|team|members?)\b/i,
  /\b(status)\b.*\b(my|our|this)\b.*\b(request|option|casting|booking|invoice)\b/i,
  /\b(available|availability)\b.*\b(today|tomorrow|this week|next week|now)\b/i,
  /\b(who)\b.*\b(organization|team|company|agency|client)\b/i,
  /\b(what did|what has)\b.*\b(client|agency|model|booker|employee)\b.*\b(say|write|send)\b/i,
];

export function getAiAssistantSubtitle(role: AiAssistantViewerRole): string {
  return uiCopy.aiAssistant.subtitles[role];
}

export function isAiAssistantLiveDataQuestion(input: string): boolean {
  const normalized = input.trim();
  if (!normalized) return false;
  return LIVE_DATA_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function getAiAssistantTerminologyContract(role: AiAssistantViewerRole): string {
  if (role === 'agency') {
    return [
      'Terminology firewall: this viewer is an Agency user. Always answer from the Agency workspace.',
      `Allowed Agency navigation labels: ${AGENCY_NAV_LABELS.join(', ')}.`,
      'Never use Client-only navigation labels or Client-only request actions for Agency instructions.',
      'If the user asks about a Client-only area, explain the closest Agency-visible place instead, or say that this is not part of the Agency workspace.',
    ].join('\n');
  }
  if (role === 'client') {
    return [
      'Terminology firewall: this viewer is a Client user. Always answer from the Client workspace.',
      `Allowed Client navigation labels: ${CLIENT_NAV_LABELS.join(', ')}.`,
      'Never use Agency-only navigation labels or Agency-only creation buttons for Client instructions.',
      'If the user asks about an Agency-only area, explain the closest Client-visible place instead, or say that this is not part of the Client workspace.',
    ].join('\n');
  }
  return [
    'Terminology firewall: this viewer is a Model user. Always answer from the Model account experience.',
    'Never use Agency-only or Client-only workspace navigation as if it is visible to Models.',
  ].join('\n');
}

export function getAiAssistantRoleKnowledge(role: AiAssistantViewerRole): string {
  if (role === 'agency') {
    return [
      'You are using IndexCasting as an Agency.',
      getAiAssistantTerminologyContract('agency'),
      'For Agency option creation: go to CALENDAR in the bottom navigation, click ADD OPTION, select or enter the model, client, date/time, and option details shown in the form, then save/create the option. The option appears in CALENDAR and can continue through confirmation or negotiation depending on the workflow. Do not use non-visible navigation labels.',
      'For Agency casting creation: go to CALENDAR, click ADD CASTING, fill in the casting details, then save/create. A casting is not the same as a confirmed booking.',
      'Use MY MODELS for model profile and media management, MESSAGES for conversations and negotiation threads, TEAM for bookers, LINKS for packages or guest links, BILLING for subscription/billing location, and SETTINGS for account or organization settings.',
    ].join('\n');
  }
  if (role === 'client') {
    return [
      'You are using IndexCasting as a Client.',
      getAiAssistantTerminologyContract('client'),
      'For Client option or casting requests: use Discover or My Projects to open the relevant model/selection, choose Request option or Request casting, select the date/time and request details shown in the form, then send the request. Do not use Agency-only navigation labels or buttons.',
      'Use My Projects to organize selections, Messages for agency conversations and negotiation threads, Calendar for visible request or job timing, Team for client organization employees, Billing for the client billing area when available, and Profile/Settings for account or organization details.',
    ].join('\n');
  }
  return [
    'You are using IndexCasting as a Model.',
    getAiAssistantTerminologyContract('model'),
    'Explain only basic model account, profile, application, media/profile completeness, and calendar concepts.',
    'Do not describe Agency-only or Client-only internal navigation as available to Models.',
  ].join('\n');
}

export function getAiAssistantWorkflowGuidance(
  role: AiAssistantViewerRole,
  topic: AiAssistantWorkflowTopic,
): string {
  if (role === 'agency' && topic === 'option') {
    return [
      'Go to CALENDAR in the bottom navigation.',
      'Click ADD OPTION.',
      'Select or enter the model, client, date/time, and option details shown in the form.',
      'Save/create the option.',
      'The option will appear in CALENDAR and can continue through confirmation or negotiation depending on the workflow.',
    ].join('\n');
  }
  if (role === 'agency' && topic === 'casting') {
    return [
      'Go to CALENDAR.',
      'Click ADD CASTING.',
      'Fill in the casting details.',
      'Save/create.',
      'A casting is not the same as a confirmed booking.',
    ].join('\n');
  }
  if (role === 'client' && topic === 'option') {
    return [
      'Use Discover or My Projects to open the relevant model or selection.',
      'Choose Request option.',
      'Select the date/time and request details shown in the form.',
      'Send the request.',
    ].join('\n');
  }
  return [
    'Use Discover or My Projects to open the relevant model or selection.',
    'Choose Request casting.',
    'Select the date/time and casting details shown in the form.',
    'Send the request.',
  ].join('\n');
}
