import { Platform } from 'react-native';
import { BREAKPOINT_TABLET_MAX } from './breakpoints';

/**
 * Central chat workspace layout tokens — widths, split ratios, message-area heights.
 * Keeps B2B / booking / inline messenger visually aligned without touching business logic.
 */

/** Overlay/card width: target share of viewport (cap below). */
export const CHAT_OVERLAY_WIDTH_PERCENT = 75;

/** Never exceed this width (px) for chat overlays on large desktops. */
export const CHAT_OVERLAY_MAX_WIDTH_CAP = 1024;

/**
 * Below this window width (px), B2B uses WhatsApp-like fullscreen chat (list OR messenger).
 * Only at/above this width is the thread|chat row split shown (true wide desktop).
 * Deliberately higher than BREAKPOINT_TABLET_MAX so that phones, tablets, and smaller
 * laptops all get the mobile-first WhatsApp pattern — no list visible while in a chat.
 */
export const CHAT_B2B_SPLIT_BREAKPOINT = 1400;

/** Wide web: thread list column ~28%, messenger ~72% of the messages row. */
export const CHAT_THREAD_LIST_FLEX = 0.28;

export const CHAT_MESSENGER_FLEX = 0.72;

/** Thread list (B2B) max height — was 220; scales slightly on web. */
export const THREAD_LIST_MAX_HEIGHT_NATIVE = 260;

export const THREAD_LIST_MAX_HEIGHT_WEB_CAP = 320;

/** Legacy option-request inline chat panel (MessagesView) — was 200. */
export const LEGACY_CHAT_PANEL_MESSAGES_MAX_HEIGHT_NATIVE = 320;

export const LEGACY_CHAT_PANEL_MESSAGES_MAX_HEIGHT_WEB_CAP = 420;

/** Native fallback when message list uses fixed max height (parent may not define flex height). */
export const MESSAGES_SCROLL_MAX_HEIGHT_NATIVE = 380;

/** Web: cap message history area as fraction of viewport height, with pixel ceiling. */
export const MESSAGES_SCROLL_VH_FRACTION = 0.5;

export const MESSAGES_SCROLL_MAX_HEIGHT_PX_CAP = 560;

export function getChatOverlayMaxWidth(windowWidth: number): number {
  return Math.min(
    Math.round(windowWidth * (CHAT_OVERLAY_WIDTH_PERCENT / 100)),
    CHAT_OVERLAY_MAX_WIDTH_CAP,
  );
}

/**
 * Max height for the main message history ScrollView (OrgMessengerInline, aligned surfaces).
 */
export function getMessagesScrollMaxHeight(windowHeight: number): number {
  if (Platform.OS === 'web') {
    return Math.min(
      Math.round(windowHeight * MESSAGES_SCROLL_VH_FRACTION),
      MESSAGES_SCROLL_MAX_HEIGHT_PX_CAP,
    );
  }
  return MESSAGES_SCROLL_MAX_HEIGHT_NATIVE;
}

export function getThreadListMaxHeight(windowHeight: number): number {
  if (Platform.OS === 'web') {
    return Math.min(Math.round(windowHeight * 0.22), THREAD_LIST_MAX_HEIGHT_WEB_CAP);
  }
  return THREAD_LIST_MAX_HEIGHT_NATIVE;
}

/** When thread|chat split is active (wide web), give the thread column more vertical room. */
export function getThreadListMaxHeightSplit(windowHeight: number): number {
  if (Platform.OS === 'web') {
    return Math.min(Math.round(windowHeight * 0.55), 640);
  }
  return THREAD_LIST_MAX_HEIGHT_NATIVE;
}

export function getLegacyChatPanelMessagesMaxHeight(windowHeight: number): number {
  if (Platform.OS === 'web') {
    return Math.min(Math.round(windowHeight * 0.42), LEGACY_CHAT_PANEL_MESSAGES_MAX_HEIGHT_WEB_CAP);
  }
  return LEGACY_CHAT_PANEL_MESSAGES_MAX_HEIGHT_NATIVE;
}

export function shouldUseB2BWebSplit(windowWidth: number): boolean {
  return Platform.OS === 'web' && windowWidth >= CHAT_B2B_SPLIT_BREAKPOINT;
}
