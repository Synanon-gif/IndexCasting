import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, type ViewStyle } from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';
import { uiCopy } from '../../constants/uiCopy';
import type { DeviceType } from '../../theme/breakpoints';

export type OptionNegotiationChatShellProps = {
  /** Main title (counterparty + context). */
  title: string;
  onBack: () => void;
  backLabel?: string;
  /** Optional second line under title (e.g. date). */
  subtitle?: string | null;
  /** Status pill on the right side of the header. */
  statusLabel: string;
  statusBackgroundColor: string;
  /** Extra control between title block and status pill (e.g. delete). */
  headerAccessory?: React.ReactNode;
  /** Agency: tap status to change negotiation state. */
  onStatusPress?: () => void;
  /** Scrollable message area */
  children: React.ReactNode;
  /** Chips / meta row pinned below title row, above message scroll. */
  headerBelowTitle?: React.ReactNode;
  /** Optional banner between action bar and composer (e.g. calendar hint). */
  composerTopBanner?: React.ReactNode;
  /** Optional area above composer (agency actions, client CTAs). */
  footerTop?: React.ReactNode;
  composer: React.ReactNode;
  /** Padding below composer (tab bar + safe area). */
  bottomInset: number;
  containerStyle?: ViewStyle;
  /** Responsive shell: optional third column on desktop only. */
  deviceType?: DeviceType;
  rightPanel?: React.ReactNode;
  /**
   * KeyboardAvoidingView vertical offset on native (iOS).
   * Default 0 works when no additional top chrome exists above the shell.
   * Pass the height of any fixed header above the shell when needed.
   */
  keyboardVerticalOffset?: number;
};

export const OptionNegotiationChatShell: React.FC<OptionNegotiationChatShellProps> = ({
  title,
  onBack,
  backLabel = uiCopy.optionNegotiationChat.back,
  subtitle,
  statusLabel,
  statusBackgroundColor,
  headerAccessory,
  onStatusPress,
  children,
  headerBelowTitle,
  composerTopBanner,
  footerTop,
  composer,
  bottomInset,
  containerStyle,
  deviceType,
  rightPanel,
  keyboardVerticalOffset = 0,
}) => {
  const showRightRail = !!rightPanel && deviceType === 'desktop';

  const innerContent = (
    <View style={styles.mainColumn}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={styles.backBtn}>
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backText} numberOfLines={1}>{backLabel}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {headerAccessory ? <View style={styles.headerAccessory}>{headerAccessory}</View> : null}
        {onStatusPress ? (
          <TouchableOpacity
            style={[styles.statusPill, { backgroundColor: statusBackgroundColor }]}
            onPress={onStatusPress}
            activeOpacity={0.85}
          >
            <Text style={styles.statusPillText} numberOfLines={1}>
              {statusLabel}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.statusPill, { backgroundColor: statusBackgroundColor }]}>
            <Text style={styles.statusPillText} numberOfLines={1}>
              {statusLabel}
            </Text>
          </View>
        )}
      </View>

      {headerBelowTitle ? <View style={styles.headerMeta}>{headerBelowTitle}</View> : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        {children}
      </ScrollView>

      {footerTop ? <View style={styles.footerTop}>{footerTop}</View> : null}

      {composerTopBanner ? <View style={styles.composerBanner}>{composerTopBanner}</View> : null}

      <View style={[styles.composerWrap, { paddingBottom: bottomInset }]}>{composer}</View>
    </View>
  );

  // On native, wrap with KeyboardAvoidingView so the composer stays above the keyboard.
  // On web the browser handles viewport resize; KeyboardAvoidingView can interfere.
  const main =
    Platform.OS !== 'web' ? (
      <KeyboardAvoidingView
        style={styles.mainColumn}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        {innerContent}
      </KeyboardAvoidingView>
    ) : (
      innerContent
    );

  return (
    <View style={[styles.root, showRightRail && styles.rootWithRail, containerStyle]}>
      {main}
      {showRightRail ? <View style={styles.rightRail}>{rightPanel}</View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    alignSelf: 'stretch',
  },
  rootWithRail: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  mainColumn: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  rightRail: {
    width: 280,
    maxWidth: '32%',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
    backgroundColor: colors.surface,
    flexShrink: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    flexShrink: 0,
    minHeight: 52,
  },
  headerMeta: {
    flexShrink: 0,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
    minWidth: 48,
    maxWidth: 120,
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
    fontWeight: '600',
  },
  headerCenter: {
    flex: 1,
    minWidth: 0,
  },
  headerAccessory: {
    flexShrink: 0,
  },
  title: {
    ...typography.heading,
    fontSize: 16,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 8,
    flexShrink: 1,
    maxWidth: 130,
  },
  statusPillText: {
    ...typography.label,
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    flexGrow: 1,
  },
  footerTop: {
    flexShrink: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  composerBanner: {
    flexShrink: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: 'rgba(34, 197, 94, 0.08)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  composerWrap: {
    flexShrink: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
});
