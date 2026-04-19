import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';
import { uiCopy } from '../../constants/uiCopy';
import { navigatePublicPath } from '../../utils/publicLegalRoutes';

type Props = {
  /** Visible page title (rendered in the header). */
  title: string;
  /**
   * Where the back button should navigate. Defaults to '/' (home / app entry).
   * Trust subpages typically pass '/trust' so the back button returns to the overview.
   */
  backTo?: string;
  /** Visible label on the back button. Defaults to "Back to home". */
  backLabel?: string;
  children: React.ReactNode;
};

/**
 * Shared layout for all public Trust Center pages.
 *
 * - Renders a consistent header (title + back button) and a scrollable content area.
 * - Designed to render without authentication; only navigates via window.history pushState
 *   on web (no full reload). On native, the back button is a no-op safety net (Trust pages
 *   are primarily a web surface).
 */
export const TrustPageLayout: React.FC<Props> = ({ title, backTo = '/', backLabel, children }) => {
  const onBack = () => navigatePublicPath(backTo);
  const label = backLabel ?? uiCopy.trust.backToHome;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          <Text style={styles.backLabel}>{label}</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {children}
        <Text style={styles.lastUpdated}>{uiCopy.trust.lastUpdated}</Text>
      </ScrollView>
    </SafeAreaView>
  );
};

/** Heading + body block — keeps every Trust page visually consistent. */
export const TrustSection: React.FC<{ heading: string; body: string | React.ReactNode }> = ({
  heading,
  body,
}) => (
  <View style={styles.section}>
    <Text style={styles.heading}>{heading}</Text>
    {typeof body === 'string' ? <Text style={styles.body}>{body}</Text> : body}
  </View>
);

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    minWidth: 120,
  },
  backLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  title: {
    ...typography.heading,
    fontSize: 18,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    minWidth: 120,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xl,
    maxWidth: 760,
    alignSelf: 'center',
    width: '100%',
  },
  section: {
    marginBottom: spacing.xl,
  },
  heading: {
    ...typography.label,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  lastUpdated: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.lg,
    textAlign: 'center',
  },
});
