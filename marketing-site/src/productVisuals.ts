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
    width: 1600,
    height: 1328,
    alt: 'Index Casting calendar, client casting chat, and invoices in one workspace',
  },
  'problem-options': {
    src: `${base}/problem-options.webp`,
    width: 1444,
    height: 870,
    alt: 'Fragmented option request threads across tools',
  },
  'problem-calendar': {
    src: `${base}/problem-calendar.webp`,
    width: 1716,
    height: 1068,
    alt: 'Disconnected weekly casting calendar',
  },
  'problem-invoices': {
    src: `${base}/problem-invoices.webp`,
    width: 1536,
    height: 1020,
    alt: 'Invoices managed outside the casting workflow',
  },
  'problem-chat': {
    src: `${base}/problem-chat.webp`,
    width: 1386,
    height: 900,
    alt: 'Parallel chat without booking context',
  },
  'platform-connected': {
    src: `${base}/platform-connected.webp`,
    width: 1400,
    height: 1140,
    alt: 'Calendar, option threads, client chat, and billing connected in one workflow',
  },
  'agency-workflow': {
    src: `${base}/agency-workflow.webp`,
    width: 1400,
    height: 1156,
    alt: 'Agency calendar, client chats, and option request threads',
  },
  'agency-calendar': {
    src: `${base}/agency-calendar.webp`,
    width: 1400,
    height: 439,
    alt: 'Agency live calendar with options, castings, and jobs',
  },
  'agency-client-chat': {
    src: `${base}/agency-client-chat.webp`,
    width: 1400,
    height: 231,
    alt: 'Agency and client messaging with casting context',
  },
  'agency-option-threads': {
    src: `${base}/agency-option-threads.webp`,
    width: 1400,
    height: 509,
    alt: 'Option and casting request pipeline for agencies',
  },
  'client-discovery-phone': {
    src: `${base}/client-discovery-phone.webp`,
    width: 640,
    height: 1008,
    alt: 'Visual-first model discovery on mobile',
  },
  'client-option-threads': {
    src: `${base}/client-option-threads.webp`,
    width: 1200,
    height: 382,
    alt: 'Client option and casting requests with status',
  },
  'client-chat-workflow': {
    src: `${base}/client-chat-workflow.webp`,
    width: 1200,
    height: 565,
    alt: 'Client and agency chat with embedded request cards',
  },
  'model-phones': {
    src: `${base}/model-phones.webp`,
    width: 1400,
    height: 1211,
    alt: 'Model mobile inbox and request flow',
  },
  'model-phone-inbox': {
    src: `${base}/model-phone-inbox.webp`,
    width: 560,
    height: 532,
    alt: 'Model discovery and agency chat on mobile',
  },
  'model-phone-request': {
    src: `${base}/model-phone-request.webp`,
    width: 560,
    height: 533,
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
