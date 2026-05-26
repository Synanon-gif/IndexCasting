/**
 * Pitch-deck product visuals (cropped UI only — no slide copy).
 * Generated via scripts/extract-pitch-visuals.py from Index_Casting_Pitch_Deck_Innsbruck.pdf
 */

export type ProductVisualKey =
  | 'hero-stack'
  | 'problem-options'
  | 'problem-calendar'
  | 'problem-invoices'
  | 'problem-chat'
  | 'platform-connected'
  | 'agency-workflow'
  | 'agency-calendar'
  | 'agency-client-chat'
  | 'agency-option-threads'
  | 'client-discovery-phone'
  | 'client-option-threads'
  | 'client-chat-workflow'
  | 'model-phones'
  | 'model-phone-inbox'
  | 'model-phone-request';

export type ProductVisualMeta = {
  src: string;
  width: number;
  height: number;
  alt: string;
};

const base = '/images/product';

export const PRODUCT_VISUALS: Record<ProductVisualKey, ProductVisualMeta> = {
  'hero-stack': {
    src: `${base}/hero-stack.webp`,
    width: 2000,
    height: 1830,
    alt: 'Index Casting calendar, client casting chat, and invoices in one workspace',
  },
  'problem-options': {
    src: `${base}/problem-options.webp`,
    width: 1358,
    height: 665,
    alt: 'Fragmented option request threads across tools',
  },
  'problem-calendar': {
    src: `${base}/problem-calendar.webp`,
    width: 1540,
    height: 829,
    alt: 'Disconnected weekly casting calendar',
  },
  'problem-invoices': {
    src: `${base}/problem-invoices.webp`,
    width: 1340,
    height: 900,
    alt: 'Invoices managed outside the casting workflow',
  },
  'problem-chat': {
    src: `${base}/problem-chat.webp`,
    width: 1190,
    height: 800,
    alt: 'Parallel chat without booking context',
  },
  'platform-connected': {
    src: `${base}/platform-connected.webp`,
    width: 2000,
    height: 1596,
    alt: 'Calendar, option threads, client chat, and billing connected in one workflow',
  },
  'agency-workflow': {
    src: `${base}/agency-workflow.webp`,
    width: 2000,
    height: 2096,
    alt: 'Agency calendar, client chats, and option request threads',
  },
  'agency-calendar': {
    src: `${base}/agency-calendar.webp`,
    width: 2000,
    height: 733,
    alt: 'Agency live calendar with options, castings, and jobs',
  },
  'agency-client-chat': {
    src: `${base}/agency-client-chat.webp`,
    width: 2000,
    height: 653,
    alt: 'Agency and client messaging with casting context',
  },
  'agency-option-threads': {
    src: `${base}/agency-option-threads.webp`,
    width: 2000,
    height: 868,
    alt: 'Option and casting request pipeline for agencies',
  },
  'client-discovery-phone': {
    src: `${base}/client-discovery-phone.webp`,
    width: 686,
    height: 1894,
    alt: 'Visual-first model discovery on mobile',
  },
  'client-option-threads': {
    src: `${base}/client-option-threads.webp`,
    width: 1837,
    height: 867,
    alt: 'Client option and casting requests with status',
  },
  'client-chat-workflow': {
    src: `${base}/client-chat-workflow.webp`,
    width: 1860,
    height: 1468,
    alt: 'Client and agency chat with embedded request cards',
  },
  'model-phones': {
    src: `${base}/model-phones.webp`,
    width: 2000,
    height: 2003,
    alt: 'Model mobile inbox and request flow',
  },
  'model-phone-inbox': {
    src: `${base}/model-phone-inbox.webp`,
    width: 800,
    height: 2287,
    alt: 'Model discovery and agency chat on mobile',
  },
  'model-phone-request': {
    src: `${base}/model-phone-request.webp`,
    width: 800,
    height: 1302,
    alt: 'Model option request and availability on mobile',
  },
};

/** Maps screenshot slot ids → pitch-deck visual asset */
export const SCREENSHOT_SLOT_VISUAL: Partial<Record<string, ProductVisualKey>> = {
  'hero-overview-web': 'hero-stack',
  'hero-overview-mobile': 'client-discovery-phone',
  'agency-dashboard': 'agency-calendar',
  'agency-roster': 'agency-client-chat',
  'agency-recruiting': 'agency-option-threads',
  'agency-calendar': 'agency-calendar',
  'agency-client-thread': 'agency-client-chat',
  'agency-projects': 'agency-option-threads',
  'client-discovery-swipe': 'client-discovery-phone',
  'client-shortlist': 'client-discovery-phone',
  'client-project': 'client-option-threads',
  'client-agency-chat': 'client-chat-workflow',
  'client-booking-confirm': 'client-chat-workflow',
  'model-home-inbox': 'model-phone-inbox',
  'model-availability': 'model-phone-request',
  'model-agency-chat': 'model-phone-inbox',
  'model-calendar': 'model-phone-request',
  'model-apply': 'model-phone-inbox',
};

export function visualForSlot(slotId: string): ProductVisualMeta | undefined {
  const key = SCREENSHOT_SLOT_VISUAL[slotId];
  return key ? PRODUCT_VISUALS[key] : undefined;
}

export function visual(key: ProductVisualKey): ProductVisualMeta {
  return PRODUCT_VISUALS[key];
}
