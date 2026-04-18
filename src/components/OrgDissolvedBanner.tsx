/**
 * OrgDissolvedBanner — shown to former members of an organization that has been
 * soft-dissolved by its owner (Stage 1 of the GDPR Two-Stage dissolve flow,
 * see supabase/migrations/20260418_dissolve_organization_v2_softdissolve.sql).
 *
 * Source of truth: a personal `notifications` row of type
 * `organization_dissolved` (user_id = current user, organization_id = NULL).
 * The metadata carries `scheduled_purge_at` (ISO date) which we surface so the
 * affected user knows exactly when the shared organization data will be
 * permanently erased.
 *
 * Actions exposed (no destructive side effects in the banner itself):
 *   • Download my data — opens the GDPR personal data export flow
 *   • Delete my account — opens the personal account deletion flow
 *   • Dismiss — marks the notification as read locally
 */
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';

type Props = {
  /** ISO timestamp of the scheduled hard-purge (organizations.scheduled_purge_at). */
  scheduledPurgeAt: string | null;
  /** Optional name of the dissolved organization for context in the message. */
  organizationName?: string | null;
  onDownloadData: () => void;
  onDeleteAccount: () => void;
  onDismiss: () => void;
};

function formatPurgeDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    // YYYY-MM-DD — locale-stable, matches DB to_char in the dissolve RPC
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

export function OrgDissolvedBanner({
  scheduledPurgeAt,
  organizationName,
  onDownloadData,
  onDeleteAccount,
  onDismiss,
}: Props) {
  const insets = useSafeAreaInsets();
  const padTop = Platform.OS === 'web' ? spacing.sm : Math.max(insets.top, spacing.sm);

  const message = useMemo(() => {
    const purgeDate = formatPurgeDate(scheduledPurgeAt);
    const base = uiCopy.accountDeletion.dissolveOrgBannerMessage.replace('{purgeDate}', purgeDate);
    if (organizationName) {
      // Soft-prepend org name without breaking copy structure.
      return `${organizationName}: ${base}`;
    }
    return base;
  }, [scheduledPurgeAt, organizationName]);

  return (
    <View style={[styles.wrap, { paddingTop: padTop }]}>
      <View style={styles.textCol}>
        <Text style={styles.title}>{uiCopy.accountDeletion.dissolveOrgBannerTitle}</Text>
        <Text style={styles.message}>{message}</Text>
        <View style={styles.actionsRow}>
          <TouchableOpacity
            onPress={onDownloadData}
            accessibilityRole="button"
            hitSlop={8}
            style={[styles.actionBtn, styles.actionPrimary]}
          >
            <Text style={styles.actionPrimaryText}>
              {uiCopy.accountDeletion.dissolveOrgBannerDownload}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onDeleteAccount}
            accessibilityRole="button"
            hitSlop={8}
            style={[styles.actionBtn, styles.actionDanger]}
          >
            <Text style={styles.actionDangerText}>
              {uiCopy.accountDeletion.dissolveOrgBannerDelete}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onDismiss}
            accessibilityRole="button"
            hitSlop={8}
            style={styles.dismissBtn}
          >
            <Text style={styles.dismissText}>
              {uiCopy.accountDeletion.dissolveOrgBannerDismiss}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  textCol: {
    flex: 1,
    flexDirection: 'column',
    gap: spacing.xs,
  },
  title: {
    ...typography.label,
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  message: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  actionBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
  },
  actionPrimary: {
    borderColor: colors.textPrimary,
    backgroundColor: colors.textPrimary,
  },
  actionPrimaryText: {
    ...typography.label,
    fontSize: 12,
    color: colors.surface,
  },
  actionDanger: {
    borderColor: colors.error,
  },
  actionDangerText: {
    ...typography.label,
    fontSize: 12,
    color: colors.error,
  },
  dismissBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  dismissText: {
    ...typography.label,
    fontSize: 12,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
});
