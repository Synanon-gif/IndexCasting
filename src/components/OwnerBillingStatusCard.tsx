/**
 * Owner / member billing awareness card — displays server-backed access and plan info.
 * Checkout is owner-only (matches create-checkout-session Edge Function).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import { useAuth } from '../context/AuthContext';
import { useSubscription } from '../context/SubscriptionContext';
import {
  createCheckoutSession,
  getMyOrgSubscription,
  type AccessReason,
  type OrgSubscription,
  type PlanType,
} from '../services/subscriptionSupabase';
import { planDisplayName, planFeatureLines } from '../constants/planFeatures';
import { isStripeSandboxUiEnabled } from '../utils/stripeSandboxUi';
import { validateUrl } from '../../lib/validation';

export type OwnerBillingVariant = 'agency' | 'client';

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

function subscriptionStatusLabel(status: OrgSubscription['status']): string {
  const b = uiCopy.billing;
  switch (status) {
    case 'active':
      return b.statusActive;
    case 'trialing':
      return b.statusTrialing;
    case 'past_due':
      return b.statusPastDue;
    case 'canceled':
      return b.statusCanceled;
    default:
      return status;
  }
}

function accessReasonExplanation(
  reason: AccessReason | undefined,
  isAdminOverride: boolean,
): string {
  const b = uiCopy.billing;
  if (isAdminOverride || reason === 'admin_override') return b.ownerBillingReasonLineAdminOverride;
  switch (reason) {
    case 'trial_active':
      return b.ownerBillingReasonLineTrialActive;
    case 'subscription_active':
      return b.ownerBillingReasonLineSubscriptionActive;
    case 'no_active_subscription':
      return b.ownerBillingReasonLineNoSubscription;
    case 'trial_already_used':
      return b.ownerBillingReasonLineTrialAlreadyUsed;
    case 'no_org':
    default:
      return b.ownerBillingReasonLineNoOrg;
  }
}

interface Props {
  variant: OwnerBillingVariant;
}

export const OwnerBillingStatusCard: React.FC<Props> = ({ variant }) => {
  const { profile } = useAuth();
  const {
    loaded,
    accessStatus,
    isBlocked,
    isAdminOverride,
    trialDaysLeft,
    currentPlan,
    refresh,
  } = useSubscription();

  const [subRow, setSubRow] = useState<OrgSubscription | null>(null);
  const [subLoading, setSubLoading] = useState(true);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [returnBanner, setReturnBanner] = useState<'success' | 'cancel' | null>(null);

  const isOwner = profile?.org_member_role === 'owner';
  const trialEndsAt = accessStatus?.trial_ends_at ?? null;
  const reason = accessStatus?.reason;

  const isTrialContext =
    !isAdminOverride &&
    reason === 'trial_active' &&
    (currentPlan === 'trial' || currentPlan === null || subRow?.plan === 'trial');

  const featureLines = useMemo(() => {
    if (isAdminOverride || reason === 'admin_override') {
      return planFeatureLines('admin', false);
    }
    const p = currentPlan ?? subRow?.plan ?? null;
    return planFeatureLines(p, Boolean(isTrialContext), variant);
  }, [isAdminOverride, reason, currentPlan, subRow?.plan, isTrialContext, variant]);

  const displayPlanName = useMemo(() => {
    if (isAdminOverride || reason === 'admin_override') return uiCopy.billing.statusAdminAccess;
    const p = currentPlan ?? subRow?.plan ?? null;
    return planDisplayName(p);
  }, [isAdminOverride, reason, currentPlan, subRow?.plan]);

  const loadSub = useCallback(async () => {
    setSubLoading(true);
    try {
      const row = await getMyOrgSubscription();
      setSubRow(row);
    } finally {
      setSubLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSub();
  }, [loadSub, accessStatus?.organization_id]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const path = window.location.pathname;
    if (path.includes('/billing/success')) {
      setReturnBanner('success');
      void refresh();
      const u = new URL(window.location.href);
      u.pathname = '/';
      u.search = '';
      window.history.replaceState({}, '', u.toString());
    } else if (path.includes('/billing/cancel')) {
      setReturnBanner('cancel');
      const u = new URL(window.location.href);
      u.pathname = '/';
      u.search = '';
      window.history.replaceState({}, '', u.toString());
    }
  }, [refresh]);

  const defaultCheckoutPlan: PlanType = variant === 'client' ? 'client' : 'agency_pro';

  const handleSubscribe = useCallback(async () => {
    if (checkoutBusy) return;
    setCheckoutBusy(true);
    try {
      const result = await createCheckoutSession(defaultCheckoutPlan);
      if (!result?.checkout_url) {
        Alert.alert(uiCopy.common.error, uiCopy.billing.checkoutFailed);
        return;
      }
      if (!validateUrl(result.checkout_url).ok) {
        Alert.alert(uiCopy.common.error, uiCopy.billing.checkoutFailed);
        return;
      }
      await Linking.openURL(result.checkout_url);
    } catch {
      Alert.alert(uiCopy.common.error, uiCopy.billing.checkoutFailed);
    } finally {
      setCheckoutBusy(false);
    }
  }, [checkoutBusy, defaultCheckoutPlan]);

  const b = uiCopy.billing;

  if (!isOwner) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{b.ownerBillingReadOnlyTitle}</Text>
        <Text style={styles.body}>{b.ownerBillingReadOnlyBody}</Text>
      </View>
    );
  }

  if (!loaded) {
    return (
      <View style={[styles.card, styles.centerRow]}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
        <Text style={styles.muted}>{uiCopy.dashboard.summaryLoading}</Text>
      </View>
    );
  }

  const showTrialSubscribeCta = !isBlocked && reason === 'trial_active';
  const showSandboxLine = isStripeSandboxUiEnabled();

  return (
    <View style={styles.card}>
      {returnBanner === 'success' && (
        <View style={styles.bannerOk}>
          <Text style={styles.bannerOkText}>{b.ownerBillingCheckoutReturnedSuccess}</Text>
        </View>
      )}
      {returnBanner === 'cancel' && (
        <View style={styles.bannerNeutral}>
          <Text style={styles.bannerNeutralText}>{b.ownerBillingCheckoutReturnedCancel}</Text>
        </View>
      )}

      <Text style={styles.cardTitle}>{b.ownerBillingCardTitle}</Text>

      <Text style={styles.sectionLabel}>{b.ownerBillingAccessLabel}</Text>
      <Text style={styles.body}>{accessReasonExplanation(reason, isAdminOverride)}</Text>

      {!isAdminOverride && reason === 'trial_active' && trialDaysLeft > 0 && (
        <Text style={styles.emphasis}>
          {b.ownerBillingTrialDaysLeft(trialDaysLeft)}
          {trialEndsAt ? ` · ${b.ownerBillingTrialEndsLabel}: ${formatShortDate(trialEndsAt)}` : ''}
        </Text>
      )}

      <Text style={[styles.sectionLabel, styles.gapTop]}>{b.ownerBillingCurrentPlanLabel}</Text>
      <Text style={styles.emphasis}>{displayPlanName}</Text>

      {subLoading ? (
        <ActivityIndicator style={styles.mtSm} size="small" color={colors.textSecondary} />
      ) : subRow ? (
        <>
          <Text style={styles.metaLine}>
            {b.ownerBillingSubscriptionStatusLabel}: {subscriptionStatusLabel(subRow.status)}
          </Text>
          {subRow.current_period_end && (
            <Text style={styles.metaLine}>
              {b.ownerBillingBillingPeriodEndLabel}: {formatShortDate(subRow.current_period_end)}
            </Text>
          )}
        </>
      ) : null}

      <Text style={[styles.sectionLabel, styles.gapTop]}>{b.ownerBillingFeaturesTitle}</Text>
      {reason === 'trial_active' && !isAdminOverride && (
        <Text style={styles.bodySmall}>{b.ownerBillingIncludedIntroTrial}</Text>
      )}
      {featureLines.map((line) => (
        <View key={line} style={styles.featureRow}>
          <Text style={styles.featureBullet}>✓</Text>
          <Text style={styles.body}>{line}</Text>
        </View>
      ))}

      {variant === 'agency' && (
        <Text style={[styles.bodySmallMuted, styles.gapTop]}>{b.ownerBillingAgencyTeamNote}</Text>
      )}

      <Text style={styles.bodySmallMuted}>{b.billingPaymentsProcessedBy}</Text>
      {showSandboxLine && (
        <Text style={styles.sandboxLine}>{b.billingTestModeNotice}</Text>
      )}

      {showTrialSubscribeCta && (
        <>
          <Text style={[styles.body, styles.gapTop]}>{b.ownerBillingNextStepTrial}</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => void handleSubscribe()}
            disabled={checkoutBusy}
          >
            {checkoutBusy ? (
              <ActivityIndicator size="small" color={colors.surface} />
            ) : (
              <Text style={styles.primaryBtnText}>{b.ownerBillingUpgradeFromTrialCTA}</Text>
            )}
          </TouchableOpacity>
        </>
      )}

      {!isBlocked && reason === 'subscription_active' && (
        <Text style={[styles.bodySmallMuted, styles.gapTop]}>
          {b.ownerBillingNextStepSubscribe}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    ...typography.heading,
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
  },
  body: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  bodySmall: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  bodySmallMuted: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    opacity: 0.9,
  },
  emphasis: {
    ...typography.body,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  metaLine: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: 4,
  },
  featureBullet: {
    color: colors.accentGreen,
    fontWeight: '700',
    fontSize: 14,
    marginTop: 2,
  },
  gapTop: {
    marginTop: spacing.md,
  },
  mtSm: {
    marginTop: spacing.sm,
  },
  centerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  muted: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
  },
  primaryBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.accentGreen,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  primaryBtnText: {
    ...typography.label,
    color: colors.surface,
  },
  sandboxLine: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
  bannerOk: {
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderRadius: 8,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.35)',
  },
  bannerOkText: {
    ...typography.body,
    fontSize: 13,
    color: colors.textPrimary,
  },
  bannerNeutral: {
    backgroundColor: colors.background,
    borderRadius: 8,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bannerNeutralText: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
  },
});
