import React from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Text, useWindowDimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, typography } from '../theme/theme';
import { isMobileWidth } from '../theme/breakpoints';
import { BOTTOM_TAB_BAR_HEIGHT } from '../navigation/bottomTabNavigation';

export type ChatLayoutFixProps = {
  header?: React.ReactNode;
  messageList: React.ReactNode;
  composer: React.ReactNode;
  /** Space reserved below composer for tab bar; default `BOTTOM_TAB_BAR_HEIGHT`. Pass `0` if there is no tab bar. */
  bottomTabInset?: number;
  /** Horizontal padding for messages + composer; use 0 when parent already pads (e.g. card). */
  edgePadding?: number;
  /**
   * When provided, a WhatsApp-like back button is prepended to the header row.
   * Non-breaking: existing call-sites that don't pass onBack see no change.
   */
  onBack?: () => void;
  backLabel?: string;
};

export default function ChatLayoutFix({
  header,
  messageList,
  composer,
  bottomTabInset,
  edgePadding: edgePaddingProp,
  onBack,
  backLabel = 'Back',
}: ChatLayoutFixProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const edgePadding = edgePaddingProp ?? (isMobileWidth(width) ? spacing.sm : 16);

  const tabBarReserve =
    bottomTabInset !== undefined ? bottomTabInset : BOTTOM_TAB_BAR_HEIGHT;
  /**
   * When tabBarReserve === 0 the parent shell no longer reserves any space (tab bar hidden or
   * parent already handled it). We still apply insets.bottom so the composer clears the device
   * home indicator / safe-area on notched phones and PWA mode.
   * On regular browser views insets.bottom is 0, so this has no visible effect.
   */
  const composerBottomPadding =
    tabBarReserve === 0 ? insets.bottom : tabBarReserve + insets.bottom;

  // When onBack is provided, prepend the back button to the header area.
  const headerContent = onBack ? (
    <View style={styles.headerRow}>
      <TouchableOpacity
        onPress={onBack}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={styles.backBtn}
      >
        <Text style={styles.backArrow}>←</Text>
        <Text style={styles.backText}>{backLabel}</Text>
      </TouchableOpacity>
      {header ? <View style={styles.headerContent}>{header}</View> : null}
    </View>
  ) : header ? (
    <View style={styles.header}>{header}</View>
  ) : null;

  return (
    <View style={styles.screen}>
      {headerContent}

      <View style={styles.content}>
        <ScrollView
          style={styles.messagesScroll}
          contentContainerStyle={[
            styles.messagesContent,
            { paddingHorizontal: edgePadding },
            { flexGrow: 1 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          {messageList}
        </ScrollView>

        <View
          style={[
            styles.composerWrap,
            { paddingBottom: composerBottomPadding, paddingHorizontal: edgePadding },
          ]}
        >
          {composer}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
  },
  header: {
    flexShrink: 0,
  },
  // Row that contains back button + optional header content side-by-side
  headerRow: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerContent: {
    flex: 1,
    minWidth: 0,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
    minWidth: 48,
    maxWidth: 90,
  },
  backArrow: {
    ...typography.label,
    fontSize: 18,
    color: colors.textPrimary,
  },
  backText: {
    ...typography.label,
    fontSize: 13,
    color: colors.accent,
    fontWeight: '600' as const,
  },
  content: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  messagesScroll: {
    flex: 1,
    minHeight: 0,
    ...(Platform.OS === 'web' ? { height: 0 } : {}),
  },
  messagesContent: {
    paddingTop: 12,
    paddingBottom: 12,
  },
  composerWrap: {
    flexShrink: 0,
    paddingTop: 10,
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
