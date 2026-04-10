import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, type ViewStyle } from 'react-native';
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
  /** Optional area above composer (agency actions, client CTAs). */
  footerTop?: React.ReactNode;
  composer: React.ReactNode;
  /** Padding below composer (tab bar + safe area). */
  bottomInset: number;
  containerStyle?: ViewStyle;
  /** Responsive shell: optional third column on desktop only. */
  deviceType?: DeviceType;
  rightPanel?: React.ReactNode;
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
  footerTop,
  composer,
  bottomInset,
  containerStyle,
  deviceType,
  rightPanel,
}) => {
  const showRightRail = !!rightPanel && deviceType === 'desktop';

  const main = (
    <View style={styles.mainColumn}>
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={styles.backBtn}>
        <Text style={styles.backArrow}>←</Text>
        <Text style={styles.backText}>{backLabel}</Text>
      </TouchableOpacity>
      <View style={styles.headerCenter}>
        <Text style={styles.title} numberOfLines={1}>
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

    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator
    >
      {children}
    </ScrollView>

    {footerTop ? <View style={styles.footerTop}>{footerTop}</View> : null}

    <View style={[styles.composerWrap, { paddingBottom: bottomInset }]}>{composer}</View>
    </View>
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
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    flexShrink: 0,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '28%',
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
    maxWidth: '34%',
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
  composerWrap: {
    flexShrink: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
});
